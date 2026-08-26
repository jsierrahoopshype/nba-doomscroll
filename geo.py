"""
Station coordinates and taxi fare estimation for the travel radar.

WHY THIS EXISTS
The best family destinations are usually not the city with the station. Salou is
reached from Camp de Tarragona, Nerja from Malaga, Sanxenxo from Pontevedra,
Benicassim from Castellon. Campsites and bungalow parks in particular sit outside
town. So the radar has to price the last leg, not pretend it is free.

COORDINATE PRECISION
Station coordinates below are station-level approximations, good to a few hundred
metres. That is immaterial for fares over 5-40 km (well under 1 EUR of error) but
do not use them for navigation.

FARE MODEL
Spanish taxi tariffs are set per municipality and vary by time of day and weekday,
so a single national model is an estimate, not a quote. It is deliberately tuned
to come out slightly HIGH, so the radar understates a bargain rather than
overstating one. Always surfaced as an estimate.
"""

import math
from typing import Any, Dict, Optional

# Straight-line to road distance. Calibrated against known transfers: coastal
# motorway runs come out near 1.15, rural and mountain roads nearer 1.4.
ROAD_DETOUR_FACTOR = 1.25

BASE_FARE_EUR = 4.00
PER_KM_EUR = 1.30
MINIMUM_FARE_EUR = 8.00
# Weekend and holiday tariff (Tarifa 2 in most municipalities) is roughly 15%
# over the weekday rate, and that is when this family travels.
WEEKEND_UPLIFT = 1.15
# A standard taxi seats 4. Four people plus luggage for several nights usually
# needs a monovolumen. Cities charge this as a modest fixed supplement, not a
# percentage, so applying it additively keeps long transfers realistic. An
# earlier multiplicative version overstated Malaga-Nerja by about 25%.
LARGE_VEHICLE_SUPPLEMENT_EUR = 5.00
# Spanish airports levy a fixed pickup supplement that stations do not, and most
# have a minimum fare from the rank. Applied only to entries flagged is_airport.
AIRPORT_SUPPLEMENT_EUR = 5.50
AIRPORT_MINIMUM_FARE_EUR = 20.00

AVERAGE_SPEED_KMH = 65.0

# Threshold from the radar's own rules: beyond roughly this, a taxi transfer only
# makes sense for a self-contained place (campsite, bungalow park, resort) where
# nobody needs to leave again during the stay.
SELF_CONTAINED_ONLY_MINUTES = 20
# A frequent local train is not isolating the way a costly cab is, so it earns a
# longer threshold before a place counts as self-contained-only.
RAIL_SELF_CONTAINED_ONLY_MINUTES = 45

# What an hour of the whole family's holiday time is worth, used to decide
# whether paying for a cab to skip a slow tram is rational. Deliberately modest:
# the point is to stop the radar buying back time at any price. Higher on a short
# break because the hours are scarcer there.
TIME_VALUE_EUR_PER_HOUR = 30.0
TIME_VALUE_SHORT_STAY_EUR_PER_HOUR = 45.0

# Long-distance stations, spread deliberately so every region of mainland Spain
# has a gateway. Keys are uppercase and accent-free for stable lookup.
STATIONS: Dict[str, Dict[str, Any]] = {
    # Madrid
    "MADRID": {"lat": 40.4067, "lon": -3.6906, "name": "Madrid Puerta de Atocha"},
    "MADRID CHAMARTIN": {"lat": 40.4720, "lon": -3.6828, "name": "Madrid Chamartin"},
    # Andalucia
    "SEVILLA": {"lat": 37.3919, "lon": -5.9757, "name": "Sevilla Santa Justa"},
    "MALAGA": {"lat": 36.7118, "lon": -4.4310, "name": "Malaga Maria Zambrano"},
    "CORDOBA": {"lat": 37.8912, "lon": -4.7906, "name": "Cordoba Central"},
    "GRANADA": {"lat": 37.1889, "lon": -3.6094, "name": "Granada"},
    "CADIZ": {"lat": 36.5340, "lon": -6.2793, "name": "Cadiz"},
    "JEREZ": {"lat": 36.7059, "lon": -6.1257, "name": "Jerez de la Frontera"},
    "ALMERIA": {"lat": 36.8395, "lon": -2.4520, "name": "Almeria"},
    "HUELVA": {"lat": 37.2664, "lon": -6.9153, "name": "Huelva"},
    "ANTEQUERA": {"lat": 37.1183, "lon": -4.7290, "name": "Antequera Santa Ana"},
    # Levante and Murcia
    "VALENCIA": {"lat": 39.4592, "lon": -0.3830, "name": "Valencia Joaquin Sorolla"},
    "ALICANTE": {"lat": 38.3444, "lon": -0.4917, "name": "Alicante Terminal"},
    "CASTELLON": {"lat": 39.9930, "lon": -0.0430, "name": "Castello de la Plana"},
    "MURCIA": {"lat": 37.9739, "lon": -1.1320, "name": "Murcia del Carmen"},
    "CARTAGENA": {"lat": 37.6053, "lon": -0.9846, "name": "Cartagena"},
    "ELCHE": {"lat": 38.2690, "lon": -0.6870, "name": "Elche Carrus"},
    # Cataluna
    "BARCELONA": {"lat": 41.3792, "lon": 2.1400, "name": "Barcelona Sants"},
    "CAMP DE TARRAGONA": {"lat": 41.1770, "lon": 1.2170, "name": "Camp de Tarragona"},
    "TARRAGONA": {"lat": 41.1130, "lon": 1.2530, "name": "Tarragona"},
    "GIRONA": {"lat": 41.9790, "lon": 2.8160, "name": "Girona"},
    "FIGUERES": {"lat": 42.2570, "lon": 2.9440, "name": "Figueres Vilafant"},
    "LLEIDA": {"lat": 41.6200, "lon": 0.6330, "name": "Lleida Pirineus"},
    # Aragon, Navarra, La Rioja
    "ZARAGOZA": {"lat": 41.6590, "lon": -0.9110, "name": "Zaragoza Delicias"},
    "HUESCA": {"lat": 42.1310, "lon": -0.4090, "name": "Huesca"},
    "TERUEL": {"lat": 40.3430, "lon": -1.1090, "name": "Teruel"},
    "PAMPLONA": {"lat": 42.8290, "lon": -1.6520, "name": "Pamplona"},
    "LOGRONO": {"lat": 42.4600, "lon": -2.4470, "name": "Logrono"},
    "CALATAYUD": {"lat": 41.3550, "lon": -1.6360, "name": "Calatayud"},
    # Norte
    "BILBAO": {"lat": 43.2600, "lon": -2.9350, "name": "Bilbao Abando"},
    "SAN SEBASTIAN": {"lat": 43.3170, "lon": -1.9760, "name": "Donostia San Sebastian"},
    "VITORIA": {"lat": 42.8460, "lon": -2.6760, "name": "Vitoria Gasteiz"},
    "SANTANDER": {"lat": 43.4610, "lon": -3.8090, "name": "Santander"},
    "OVIEDO": {"lat": 43.3630, "lon": -5.8500, "name": "Oviedo"},
    "GIJON": {"lat": 43.5340, "lon": -5.6690, "name": "Gijon Sanz Crespo"},
    "LEON": {"lat": 42.5990, "lon": -5.5890, "name": "Leon"},
    "BURGOS": {"lat": 42.3560, "lon": -3.6900, "name": "Burgos Rosa de Lima"},
    "PALENCIA": {"lat": 42.0180, "lon": -4.5310, "name": "Palencia"},
    "VALLADOLID": {"lat": 41.6410, "lon": -4.7260, "name": "Valladolid Campo Grande"},
    # Galicia
    "SANTIAGO": {"lat": 42.8700, "lon": -8.5440, "name": "Santiago de Compostela"},
    "A CORUNA": {"lat": 43.3530, "lon": -8.4100, "name": "A Coruna"},
    "VIGO": {"lat": 42.2400, "lon": -8.7130, "name": "Vigo Urzaiz"},
    "PONTEVEDRA": {"lat": 42.4290, "lon": -8.6440, "name": "Pontevedra"},
    "OURENSE": {"lat": 42.3560, "lon": -7.8630, "name": "Ourense"},
    "FERROL": {"lat": 43.4830, "lon": -8.2340, "name": "Ferrol"},
    # Castilla and Extremadura
    "SALAMANCA": {"lat": 40.9720, "lon": -5.6540, "name": "Salamanca"},
    "ZAMORA": {"lat": 41.5210, "lon": -5.7300, "name": "Zamora"},
    "SEGOVIA": {"lat": 40.9130, "lon": -4.0940, "name": "Segovia Guiomar"},
    "AVILA": {"lat": 40.6580, "lon": -4.6970, "name": "Avila"},
    "TOLEDO": {"lat": 39.8620, "lon": -4.0220, "name": "Toledo"},
    "CUENCA": {"lat": 39.9900, "lon": -2.0700, "name": "Cuenca Fernando Zobel"},
    "ALBACETE": {"lat": 38.9930, "lon": -1.8500, "name": "Albacete Los Llanos"},
    "CIUDAD REAL": {"lat": 38.9860, "lon": -3.9200, "name": "Ciudad Real"},
    "BADAJOZ": {"lat": 38.8800, "lon": -6.9700, "name": "Badajoz"},
    "CACERES": {"lat": 39.4700, "lon": -6.3620, "name": "Caceres"},
    "MERIDA": {"lat": 38.9180, "lon": -6.3390, "name": "Merida"},
    "PLASENCIA": {"lat": 40.0270, "lon": -6.0890, "name": "Plasencia"},
}

# Airports. The radar prices flights daily, so those need a last leg too. Same
# lookup as stations; is_airport adds the pickup supplement and higher minimum.
AIRPORTS: Dict[str, Dict[str, Any]] = {
    "MAD": {"lat": 40.4936, "lon": -3.5668, "name": "Madrid Barajas", "is_airport": True},
    "BCN": {"lat": 41.2971, "lon": 2.0785, "name": "Barcelona El Prat", "is_airport": True},
    "AGP": {"lat": 36.6749, "lon": -4.4991, "name": "Malaga Costa del Sol", "is_airport": True},
    "ALC": {"lat": 38.2822, "lon": -0.5582, "name": "Alicante Elche", "is_airport": True},
    "VLC": {"lat": 39.4893, "lon": -0.4816, "name": "Valencia", "is_airport": True},
    "PMI": {"lat": 39.5517, "lon": 2.7388, "name": "Palma de Mallorca", "is_airport": True},
    "IBZ": {"lat": 38.8729, "lon": 1.3731, "name": "Ibiza", "is_airport": True},
    "MAH": {"lat": 39.8626, "lon": 4.2186, "name": "Menorca", "is_airport": True},
    "SVQ": {"lat": 37.4180, "lon": -5.8931, "name": "Sevilla", "is_airport": True},
    "BIO": {"lat": 43.3011, "lon": -2.9106, "name": "Bilbao", "is_airport": True},
    "SCQ": {"lat": 42.8963, "lon": -8.4151, "name": "Santiago de Compostela", "is_airport": True},
    "VGO": {"lat": 42.2318, "lon": -8.6267, "name": "Vigo", "is_airport": True},
    "OVD": {"lat": 43.5636, "lon": -6.0346, "name": "Asturias", "is_airport": True},
    "SDR": {"lat": 43.4271, "lon": -3.8200, "name": "Santander", "is_airport": True},
    "GRX": {"lat": 37.1889, "lon": -3.7776, "name": "Granada Jaen", "is_airport": True},
    "XRY": {"lat": 36.7446, "lon": -6.0601, "name": "Jerez", "is_airport": True},
    "RMU": {"lat": 37.8030, "lon": -1.1250, "name": "Murcia Corvera", "is_airport": True},
    "REU": {"lat": 41.1474, "lon": 1.1672, "name": "Reus", "is_airport": True},
    "GRO": {"lat": 41.9010, "lon": 2.7605, "name": "Girona Costa Brava", "is_airport": True},
    "LPA": {"lat": 27.9319, "lon": -15.3866, "name": "Gran Canaria", "is_airport": True},
    "TFS": {"lat": 28.0445, "lon": -16.5725, "name": "Tenerife Sur", "is_airport": True},
    "ACE": {"lat": 28.9455, "lon": -13.6052, "name": "Lanzarote", "is_airport": True},
    "FUE": {"lat": 28.4527, "lon": -13.8638, "name": "Fuerteventura", "is_airport": True},
}
STATIONS.update(AIRPORTS)

# Airport express buses, which are usually the sane option into the city and are
# priced per person like any transit. Same headcount trap applies.
AIRPORT_BUS: Dict[str, Dict[str, Any]] = {
    "AGP": {"service": "Bus A-Express to Malaga centre", "fare_pp_eur": 4.00, "minutes": 20},
    "ALC": {"service": "Bus C-6 to Alicante centre", "fare_pp_eur": 4.00, "minutes": 25},
    "PMI": {"service": "Bus A1 to Palma centre", "fare_pp_eur": 5.00, "minutes": 20},
    "VLC": {"service": "Metro L3/L5 to Valencia centre", "fare_pp_eur": 4.90, "minutes": 25},
    "BCN": {"service": "Aerobus to Placa Catalunya", "fare_pp_eur": 7.25, "minutes": 35},
    "MAD": {"service": "Metro L8 + supplement, or Expres Aeropuerto", "fare_pp_eur": 5.00, "minutes": 30},
    "SVQ": {"service": "Bus EA to Sevilla centre", "fare_pp_eur": 4.00, "minutes": 35},
    "IBZ": {"service": "Bus L10 to Ibiza Town", "fare_pp_eur": 4.00, "minutes": 20},
    "BIO": {"service": "Bizkaibus A3247 to Bilbao centre", "fare_pp_eur": 3.00, "minutes": 25},
}


# Local rail and tram reaching good family areas from a long-distance gateway.
#
# TWO THINGS THIS MODEL GETS RIGHT THAT THE OBVIOUS ONE DOES NOT:
# 1. Public transport fares multiply by headcount, taxi fares do not. Comparing a
#    per-person tram fare against a whole-car taxi fare flatters the tram. For
#    four people the crossover is much closer than it looks.
# 2. Time is a real cost with two young kids, and it bites hardest on short
#    stays. The Alicante TRAM to Calpe is ~100 min against ~55 by road; on a two
#    night trip that is most of an afternoon each way.
#
# fare_pp_eur and minutes are one-way approximations. Coordinates let the radar
# match a property to the nearest rail-served town automatically.
LAST_MILE_RAIL: Dict[str, list] = {
    "ALICANTE": [
        {"dest": "El Campello", "service": "TRAM L1", "fare_pp_eur": 1.60, "minutes": 20, "lat": 38.4290, "lon": -0.4020},
        {"dest": "Villajoyosa", "service": "TRAM L1", "fare_pp_eur": 3.50, "minutes": 50, "lat": 38.5060, "lon": -0.2330},
        {"dest": "Benidorm", "service": "TRAM L1", "fare_pp_eur": 4.50, "minutes": 65, "lat": 38.5340, "lon": -0.1310},
        {"dest": "Altea", "service": "TRAM L9", "fare_pp_eur": 5.50, "minutes": 85, "lat": 38.5990, "lon": -0.0520},
        {"dest": "Calpe", "service": "TRAM L9", "fare_pp_eur": 6.50, "minutes": 100, "lat": 38.6450, "lon": 0.0450},
    ],
    "MALAGA": [
        {"dest": "Torremolinos", "service": "Cercanias C-1", "fare_pp_eur": 2.05, "minutes": 20, "lat": 36.6220, "lon": -4.4990},
        {"dest": "Benalmadena", "service": "Cercanias C-1", "fare_pp_eur": 2.45, "minutes": 30, "lat": 36.5980, "lon": -4.5400},
        {"dest": "Fuengirola", "service": "Cercanias C-1", "fare_pp_eur": 2.85, "minutes": 45, "lat": 36.5400, "lon": -4.6250},
    ],
    "CASTELLON": [
        {"dest": "Benicassim", "service": "Cercanias C-6", "fare_pp_eur": 2.00, "minutes": 12, "lat": 40.0540, "lon": 0.0650},
        {"dest": "Oropesa del Mar", "service": "Cercanias C-6", "fare_pp_eur": 2.60, "minutes": 20, "lat": 40.0900, "lon": 0.1400},
    ],
    "VALENCIA": [
        {"dest": "Sagunto", "service": "Cercanias C-6", "fare_pp_eur": 3.20, "minutes": 30, "lat": 39.6800, "lon": -0.2730},
        {"dest": "Cullera", "service": "Cercanias C-1", "fare_pp_eur": 4.40, "minutes": 50, "lat": 39.1640, "lon": -0.2520},
        {"dest": "Gandia", "service": "Cercanias C-1", "fare_pp_eur": 5.50, "minutes": 65, "lat": 38.9670, "lon": -0.1810},
    ],
    "BARCELONA": [
        {"dest": "Sitges", "service": "Rodalies R2 Sud", "fare_pp_eur": 4.60, "minutes": 40, "lat": 41.2370, "lon": 1.8060},
        {"dest": "Mataro", "service": "Rodalies R1", "fare_pp_eur": 4.10, "minutes": 40, "lat": 41.5390, "lon": 2.4450},
        {"dest": "Calella", "service": "Rodalies R1", "fare_pp_eur": 5.50, "minutes": 65, "lat": 41.6140, "lon": 2.6560},
    ],
    "TARRAGONA": [
        {"dest": "Salou", "service": "Rodalies", "fare_pp_eur": 2.50, "minutes": 12, "lat": 41.0763, "lon": 1.1417},
        {"dest": "Cambrils", "service": "Rodalies", "fare_pp_eur": 3.10, "minutes": 20, "lat": 41.0670, "lon": 1.0570},
        {"dest": "PortAventura", "service": "Rodalies (own halt)", "fare_pp_eur": 2.50, "minutes": 10, "lat": 41.0870, "lon": 1.1560},
    ],
    "CADIZ": [
        {"dest": "El Puerto de Santa Maria", "service": "Cercanias C-1", "fare_pp_eur": 3.15, "minutes": 35, "lat": 36.5940, "lon": -6.2330},
        {"dest": "Puerto Real", "service": "Cercanias C-1", "fare_pp_eur": 2.30, "minutes": 20, "lat": 36.5290, "lon": -6.1900},
    ],
    "BILBAO": [
        {"dest": "Getxo", "service": "Metro Bilbao L1", "fare_pp_eur": 1.90, "minutes": 25, "lat": 43.3550, "lon": -3.0130},
        {"dest": "Sopelana", "service": "Metro Bilbao L1", "fare_pp_eur": 2.60, "minutes": 35, "lat": 43.3800, "lon": -2.9900},
        {"dest": "Plentzia", "service": "Metro Bilbao L1", "fare_pp_eur": 2.60, "minutes": 40, "lat": 43.4060, "lon": -2.9490},
    ],
    "SAN SEBASTIAN": [
        {"dest": "Zarautz", "service": "Euskotren", "fare_pp_eur": 3.35, "minutes": 40, "lat": 43.2840, "lon": -2.1700},
        {"dest": "Zumaia", "service": "Euskotren", "fare_pp_eur": 3.90, "minutes": 55, "lat": 43.2960, "lon": -2.2540},
    ],
    "MURCIA": [
        {"dest": "Cartagena", "service": "Cercanias", "fare_pp_eur": 5.30, "minutes": 50, "lat": 37.6053, "lon": -0.9846},
    ],
}

# Good family areas with NO rail. Recorded explicitly so the radar prices the cab
# honestly instead of assuming a train exists.
NO_RAIL_AREAS = [
    "Nerja", "Frigiliana", "Comillas", "San Vicente de la Barquera",
    "Sanxenxo", "O Grove", "Conil de la Frontera", "Zahara de los Atunes",
    "Cadaques", "Begur", "Peniscola", "La Manga", "Mazarron",
]


# Renfe's own naming differs from the everyday Spanish name, and its lookup is a
# substring match, so an extra letter breaks it. CASTELLON fails because Renfe
# calls it CASTELLO (Valencian, no N). Translate before querying Renfe.
RENFE_NAME_ALIASES: Dict[str, str] = {
    "CASTELLON": "CASTELLO",
    "A CORUNA": "CORUNA",
    "SAN SEBASTIAN": "DONOSTIA",
    "GIRONA": "GIRONA",
    "CAMP DE TARRAGONA": "CAMP DE TARRAGONA",
}


def renfe_name(name: str) -> str:
    """Map a radar-friendly station name to what Renfe's lookup expects."""
    return RENFE_NAME_ALIASES.get(_normalise(name), name)


def _normalise(name: str) -> str:
    """Uppercase, strip accents, collapse spaces, so 'Camp de Tarragona' matches."""
    table = str.maketrans("ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ", "AAAAEEEEIIIIOOOOUUUUNC")
    return " ".join(name.upper().translate(table).split())


def lookup_station(name: str) -> Optional[Dict[str, Any]]:
    return STATIONS.get(_normalise(name))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return radius * 2 * math.asin(math.sqrt(a))


def _nearest_rail_option(station: str, lat: float, lon: float,
                         max_km: float = 6.0) -> Optional[Dict[str, Any]]:
    """Find the rail-served town nearest the property, if it is close enough to
    actually be the same place. Beyond max_km the train drops you somewhere else
    and you still need a cab, so it is not a real alternative."""
    best, best_km = None, None
    for opt in LAST_MILE_RAIL.get(_normalise(station), []):
        km = haversine_km(lat, lon, opt["lat"], opt["lon"])
        if best_km is None or km < best_km:
            best, best_km = opt, km
    if best is None or best_km > max_km:
        return None
    out = dict(best)
    out["km_from_property"] = round(best_km, 1)
    return out


def _choose_last_mile(taxi_fare: float, taxi_minutes: int,
                      rail: Optional[Dict[str, Any]],
                      passengers: int, nights: Optional[int]) -> Dict[str, Any]:
    """Weigh cost against time for a family, not for a solo traveller.

    Two corrections to the naive comparison:
      - rail cost multiplies by headcount; a taxi is one fare for the car
      - time in transit hurts far more on a 2 night trip than an 8 night one
    """
    if rail is None:
        return {"mode": "taxi", "reason": "No local rail reaches this spot, so the cab is the only way in.",
                "group_cost_round_trip_eur": round(taxi_fare * 2, 2)}

    rail_group = rail["fare_pp_eur"] * passengers
    rail_rt = round(rail_group * 2, 2)
    taxi_rt = round(taxi_fare * 2, 2)
    saving = round(taxi_rt - rail_rt, 2)
    # Round trip, and doubled again because the time is spent on both journeys.
    time_penalty = (rail["minutes"] - taxi_minutes) * 2

    # Put an explicit price on the time instead of an unbounded "short stay wins"
    # rule. Without a ceiling that rule would buy back an hour at any cost: it
    # once recommended a 234 EUR cab over a 52 EUR tram to save 68 min, which is
    # 160 EUR/hour on a trip budgeted at 40 EUR per person per night.
    # Time is scarcer on a short break, so it is worth more there.
    short_stay = nights is not None and nights <= 3
    time_value_per_hour = (TIME_VALUE_SHORT_STAY_EUR_PER_HOUR if short_stay
                           else TIME_VALUE_EUR_PER_HOUR)
    time_worth = round((time_penalty / 60.0) * time_value_per_hour, 2)

    # Effective cost = money plus the value of the hours it costs you.
    rail_effective = round(rail_rt + time_worth, 2)
    taxi_effective = taxi_rt

    if saving <= 0:
        mode, reason = "taxi", (
            f"For {passengers} people the train costs {rail_rt} EUR return against "
            f"{taxi_rt} for the cab. Fares multiply by headcount, taxi fares do not.")
    elif rail_effective <= taxi_effective:
        mode = "rail"
        if time_penalty <= 0:
            reason = (f"{rail['service']} to {rail['dest']}: {rail_rt} EUR return for "
                      f"{passengers} against {taxi_rt} by cab, and "
                      f"{abs(time_penalty)} min faster.")
        else:
            reason = (f"{rail['service']} to {rail['dest']}: {rail_rt} EUR return for "
                      f"{passengers} against {taxi_rt} by cab. Costs about "
                      f"{time_penalty} min more across the trip, worth roughly "
                      f"{time_worth} EUR at {time_value_per_hour} EUR/hour, so the "
                      f"train still wins by {round(taxi_effective - rail_effective, 2)} EUR.")
    else:
        mode, reason = "taxi", (
            f"Cab costs {round(saving, 2)} EUR more but saves about {time_penalty} min "
            f"across the trip, worth roughly {time_worth} EUR at {time_value_per_hour} "
            f"EUR/hour on a {nights} night stay. Worth paying for with two young kids.")

    return {
        "mode": mode,
        "reason": reason,
        "rail_group_round_trip_eur": rail_rt,
        "taxi_round_trip_eur": taxi_rt,
        "rail_saving_eur": saving,
        "extra_transit_minutes_whole_trip": time_penalty,
        "time_valued_at_eur_per_hour": time_value_per_hour,
        "time_penalty_worth_eur": time_worth,
        "group_cost_round_trip_eur": rail_rt if mode == "rail" else taxi_rt,
    }


def estimate_taxi(station: str, lat: float, lon: float,
                  weekend: bool = True, large_vehicle: bool = True,
                  passengers: int = 4, nights: Optional[int] = None) -> Dict[str, Any]:
    """Estimate the station-to-door leg. Returns an estimate, never a quote."""
    st = lookup_station(station)
    if st is None:
        # Never guess a coordinate. An unknown station is an explicit failure so
        # the radar cannot quietly price a transfer from the wrong place.
        return {
            "status": "unknown_station",
            "note": f"No coordinates on file for '{station}'. Add it to geo.STATIONS.",
            "known_stations": sorted(STATIONS.keys()),
        }

    straight_km = haversine_km(st["lat"], st["lon"], lat, lon)
    road_km = straight_km * ROAD_DETOUR_FACTOR

    is_airport = st.get("is_airport", False)
    fare = BASE_FARE_EUR + (road_km * PER_KM_EUR)
    if is_airport:
        fare += AIRPORT_SUPPLEMENT_EUR
    fare = max(fare, AIRPORT_MINIMUM_FARE_EUR if is_airport else MINIMUM_FARE_EUR)
    if weekend:
        fare *= WEEKEND_UPLIFT
    if large_vehicle:
        fare += LARGE_VEHICLE_SUPPLEMENT_EUR

    minutes = max(5, round(road_km / AVERAGE_SPEED_KMH * 60))

    rail = _nearest_rail_option(station, lat, lon)
    verdict = _choose_last_mile(fare, minutes, rail, passengers, nights)

    # Judge isolation by the mode actually recommended, not always by the cab.
    # The 20 minute rule exists because a taxi is costly and awkward per trip. A
    # frequent local train changes that: you can come and go all week for a few
    # euros, so a longer ride is tolerable before a place counts as isolating.
    if verdict["mode"] == "rail" and rail is not None:
        chosen_minutes = rail["minutes"]
        threshold = RAIL_SELF_CONTAINED_ONLY_MINUTES
    else:
        chosen_minutes = minutes
        threshold = SELF_CONTAINED_ONLY_MINUTES

    suitability = ("fine_for_any_lodging" if chosen_minutes <= threshold
                   else "self_contained_only")


    return {
        "status": "ok",
        "station": st["name"],
        "recommended": verdict,
        "rail_option": rail,
        "straight_line_km": round(straight_km, 1),
        "estimated_road_km": round(road_km, 1),
        "estimated_minutes": minutes,
        "one_way_eur": round(fare, 2),
        "round_trip_eur": round(fare * 2, 2),
        "suitability": suitability,
        "suitability_note": (
            f"About {chosen_minutes} min from the station by the recommended mode, "
            f"within the {threshold} min threshold, so fine for any lodging type."
            if suitability == "fine_for_any_lodging" else
            f"About {chosen_minutes} minutes from the station. Only counts if the place is "
            "self-contained (campsite, bungalow park, resort with pool, restaurant "
            "and playground on site), since nobody wants this ride twice a day."
        ),
        "assumptions": {
            "weekend_or_holiday_tariff": weekend,
            "large_vehicle_supplement_eur": LARGE_VEHICLE_SUPPLEMENT_EUR if large_vehicle else 0,
            "road_detour_factor": ROAD_DETOUR_FACTOR,
        },
        "confidence": "estimate only; Spanish taxi tariffs are set per municipality "
                      "and vary by time and day. Tuned to read slightly high.",
    }
