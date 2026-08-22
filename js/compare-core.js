/* NBA Doomscroll — comparison scoring core
 * EXTRACTED VERBATIM from nba-player-data/nba-player-comparison-tool.html
 * (lines 1472-2478 of the tool as of Aug 2026) so card scores match the live
 * HoopsMatic comparison tool exactly. Do not hand-edit the extracted block;
 * re-extract if the tool's logic changes.
 *
 * Usage (browser or Node):
 *   CompareCore.init({ awards, allStar, awardVotes, combine, nba2k, poSeries,
 *                      poStats, rsStats, salaries, sneakers, comparisons });
 *   var results = CompareCore.compare("LeBron James", "Michael Jordan");
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CompareCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var playerData = {};

  /* ---------- BEGIN VERBATIM EXTRACT ---------- */
        function parseNumericValue(value) {
            // Helper function to convert values to numbers for comparison
            if (!value) return NaN;
            
            const strValue = String(value);
            
            // Check if it's in feet-inches format (e.g., "6' 7.25''")
            const feetInchesMatch = strValue.match(/(\d+)'\s*([\d.]+)['"]+/);
            if (feetInchesMatch) {
                const feet = parseFloat(feetInchesMatch[1]);
                const inches = parseFloat(feetInchesMatch[2]);
                return (feet * 12) + inches; // Convert to total inches
            }
            
            // Otherwise strip currency symbols and commas
            return parseFloat(strValue.replace(/[\$,]/g, ''));
        }

        function performComparison(player1Name, player2Name) {
            let player1Score = 0;
            let player2Score = 0;
            const categories = {};
            const sectionScores = {}; // Track scores per section
            let currentSection = null;
            
            // Sections that award points even when opponent has no data
            const alwaysAwardSections = [
                'ACCOLADES', 
                'BEST AWARDS RANKING', 
                'YEARS RECEIVING VOTES', 
                'SIGNATURE SHOES',
                'PLAYOFF SUCCESS'
            ];
            
            // Sections that require BOTH players to have data (like DRAFT COMBINE but counts toward overall)
            const requireBothDataSections = [
                'SALARIES',
                'NBA 2K'
            ];
            
            // Sections excluded from overall score
            const excludeFromOverall = ['DRAFT COMBINE'];
            
            playerData.comparisons.forEach(comp => {
                const category = comp['Comparison points'];
                const winCondition = comp['Who wins?'];
                const dataSource = comp['Wheres the data?'];
                
                // Check if this is a section header
                if (!winCondition && !dataSource) {
                    currentSection = category;
                    categories[currentSection] = [];
                    sectionScores[currentSection] = { player1: 0, player2: 0 };
                    return;
                }
                
                if (!currentSection || !category) return;
                
                // Get player stats
                const p1Value = getPlayerStat(player1Name, category, dataSource);
                const p2Value = getPlayerStat(player2Name, category, dataSource);
                
                // Determine winner
                let winner = 'tie';
                let awardPoint = false;
                
                // Check if this section always awards points
                const alwaysAward = alwaysAwardSections.includes(currentSection);
                
                // Check if this section requires both players to have data
                const requireBothData = requireBothDataSections.includes(currentSection) || 
                                       excludeFromOverall.includes(currentSection);
                
                if (p1Value !== null && p2Value !== null) {
                    // Both have data - normal comparison
                    const p1Num = parseNumericValue(p1Value);
                    const p2Num = parseNumericValue(p2Value);
                    
                    if (!isNaN(p1Num) && !isNaN(p2Num)) {
                        if (winCondition === 'Most') {
                            if (p1Num > p2Num) {
                                winner = 'player1';
                                awardPoint = true;
                            } else if (p2Num > p1Num) {
                                winner = 'player2';
                                awardPoint = true;
                            }
                        } else if (winCondition === 'Least') {
                            if (p1Num < p2Num) {
                                winner = 'player1';
                                awardPoint = true;
                            } else if (p2Num < p1Num) {
                                winner = 'player2';
                                awardPoint = true;
                            }
                        }
                        
                        // Check if this is an untracked stat (steals/blocks/turnovers/3P with a 0)
                        if (awardPoint) {
                            const untrackedSections = ['NBA CAREER AVERAGES', 'NBA CAREER TOTALS', 'NBA SEASON PEAK'];
                            const untrackedCategories = ['steals', 'steal', 'blocks', 'block', 'turnovers', 'turnover', 'three', '3p', 'stl', 'blk', 'tov'];
                            
                            const inUntrackedSection = untrackedSections.some(s => 
                                currentSection && currentSection.trim().toUpperCase() === s.toUpperCase()
                            );
                            
                            const isUntrackedCategory = untrackedCategories.some(c => 
                                category && category.toLowerCase().includes(c)
                            );
                            
                            // Check if value is zero - check both raw and parsed
                            const isZeroValue = (rawVal, numVal) => {
                                if (numVal === 0) return true;
                                const strVal = String(rawVal).trim();
                                if (strVal === '0' || strVal === '0.0' || strVal === '0.00') return true;
                                return parseFloat(strVal) === 0;
                            };
                            
                            const p1IsZero = isZeroValue(p1Value, p1Num);
                            const p2IsZero = isZeroValue(p2Value, p2Num);
                            
                            // If either player has 0, don't award the point (stat wasn't tracked for them)
                            if (inUntrackedSection && isUntrackedCategory) {
                                if (p1IsZero || p2IsZero) {
                                    awardPoint = false;
                                    winner = 'tie';  // Also set to tie so row isn't highlighted
                                }
                            }
                        }
                    }
                } else if (alwaysAward && !requireBothData) {
                    // Only one has data - award point if in special sections (and not requiring both)
                    if (p1Value !== null && p2Value === null) {
                        const p1Num = parseNumericValue(p1Value);
                        if (!isNaN(p1Num) && p1Num > 0) {
                            winner = 'player1';
                            awardPoint = true;
                        }
                    } else if (p2Value !== null && p1Value === null) {
                        const p2Num = parseNumericValue(p2Value);
                        if (!isNaN(p2Num) && p2Num > 0) {
                            winner = 'player2';
                            awardPoint = true;
                        }
                    }
                }
                
                // Award points
                if (awardPoint) {
                    if (winner === 'player1') {
                        sectionScores[currentSection].player1++;
                        // Add to overall score unless it's an excluded section
                        if (!excludeFromOverall.includes(currentSection)) {
                            player1Score++;
                        }
                    } else if (winner === 'player2') {
                        sectionScores[currentSection].player2++;
                        // Add to overall score unless it's an excluded section
                        if (!excludeFromOverall.includes(currentSection)) {
                            player2Score++;
                        }
                    }
                }
                
                categories[currentSection].push({
                    metric: category,
                    player1Value: p1Value,
                    player2Value: p2Value,
                    winner: winner
                });
            });
            
            // Remove empty comparisons and untracked stats where both have 0
            Object.keys(categories).forEach(sectionName => {
                categories[sectionName] = categories[sectionName].filter(item => {
                    // First check: at least one player has data
                    if (item.player1Value === null && item.player2Value === null) {
                        return false;
                    }
                    
                    // Second check: for untracked stats, hide if BOTH have 0
                    const untrackedSections = ['NBA CAREER AVERAGES', 'NBA CAREER TOTALS', 'NBA SEASON PEAK'];
                    const untrackedCategories = ['steals', 'steal', 'blocks', 'block', 'turnovers', 'turnover', 'three', '3p', 'stl', 'blk', 'tov'];
                    
                    const inUntrackedSection = untrackedSections.some(s => 
                        sectionName && sectionName.trim().toUpperCase() === s.toUpperCase()
                    );
                    
                    const isUntrackedCategory = untrackedCategories.some(c => 
                        item.metric && item.metric.toLowerCase().includes(c)
                    );
                    
                    if (inUntrackedSection && isUntrackedCategory) {
                        // Check if both values are 0
                        const isZero = (val) => {
                            if (val === null || val === undefined) return false;
                            if (val === '-' || val === '–') return true;
                            const strVal = String(val).trim();
                            if (strVal === '0' || strVal === '0.0' || strVal === '0.00') return true;
                            return parseFloat(strVal) === 0;
                        };
                        
                        if (isZero(item.player1Value) && isZero(item.player2Value)) {
                            return false; // Hide this row
                        }
                    }
                    
                    return true; // Show this row
                });
            });
            
            return {
                player1: player1Name,
                player2: player2Name,
                player1Score: player1Score,
                player2Score: player2Score,
                categories: categories,
                sectionScores: sectionScores
            };
        }

        function getPlayerStat(playerName, metric, dataSource) {
            if (!dataSource) return null;
            
            // Map metric to actual data field based on data source
            if (dataSource === 'Awards.csv') {
                return getAwardCount(playerName, metric);
            } else if (dataSource === 'RS-Stats.csv') {
                return getRegularSeasonStat(playerName, metric);
            } else if (dataSource === 'PO-Stats.csv') {
                return getPlayoffStat(playerName, metric);
            } else if (dataSource === 'PO-series.csv') {
                return getPlayoffSeriesStat(playerName, metric);
            } else if (dataSource === 'Salaries.csv') {
                return getSalaryStat(playerName, metric);
            } else if (dataSource === 'Combine.csv') {
                return getCombineStat(playerName, metric);
            } else if (dataSource === 'Award-Votes.csv') {
                return getVotingStat(playerName, metric);
            } else if (dataSource === 'Sneakers.csv') {
                return getSneakerStat(playerName, metric);
            } else if (dataSource === 'NBA2K.csv') {
                return get2KRating(playerName, metric);
            } else if (dataSource === 'All-Star.csv') {
                return getAllStarContestWins(playerName, metric);
            }
            
            return null;
        }

        function getAwardCount(playerName, awardType) {
            // Handle combined awards
            if (awardType === 'All-NBA Selections') {
                const first = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'All-NBA First Team'
                ).length;
                const second = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'All-NBA Second Team'
                ).length;
                const third = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'All-NBA Third Team'
                ).length;
                const total = first + second + third;
                return total > 0 ? total : null;
            }
            
            if (awardType === 'All-Defensive Team Selections') {
                const first = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'All-Defensive First Team'
                ).length;
                const second = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'All-Defensive Second Team'
                ).length;
                const total = first + second;
                return total > 0 ? total : null;
            }
            
            if (awardType === 'Olympic Medals') {
                const gold = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'Olympic Gold'
                ).length;
                const silver = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'Olympic Silver'
                ).length;
                const bronze = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'Olympic Bronze'
                ).length;
                const total = gold + silver + bronze;
                return total > 0 ? total : null;
            }
            
            if (awardType === 'World Cup Medals') {
                const gold = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'World Cup Gold'
                ).length;
                const silver = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'World Cup Silver'
                ).length;
                const bronze = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'World Cup Bronze'
                ).length;
                const total = gold + silver + bronze;
                return total > 0 ? total : null;
            }
            
            // Conference Finals MVP combines EC Finals MVP and WC Finals MVP
            if (awardType === 'Conference Finals MVP') {
                const ec = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'EC Finals MVP'
                ).length;
                const wc = playerData.awards.filter(row => 
                    row['PLAYER / COACH'] === playerName && row.AWARD === 'WC Finals MVP'
                ).length;
                const total = ec + wc;
                return total > 0 ? total : null;
            }
            
            // Regular award count
            const playerAwards = playerData.awards.filter(row => 
                row['PLAYER / COACH'] === playerName && row.AWARD === awardType
            );
            return playerAwards.length > 0 ? playerAwards.length : null;
        }

        // ==========================================
        // MULTI-TEAM SEASON DEDUPLICATION
        // When a player plays for multiple teams in one season, the data contains
        // separate rows per team PLUS a "TOT" row with aggregated stats.
        // Without deduplication, career stats double-count and peaks use partial stints.
        // This function keeps only one row per season: the TOT row if it exists,
        // otherwise the single team row, otherwise aggregates partial rows.
        // ==========================================
        function deduplicateSeasonRows(playerRows) {
            // Group rows by YEAR
            const byYear = {};
            playerRows.forEach(row => {
                const year = row.YEAR || 'unknown';
                if (!byYear[year]) byYear[year] = [];
                byYear[year].push(row);
            });
            
            const deduplicated = [];
            for (const year in byYear) {
                const yearRows = byYear[year];
                
                if (yearRows.length === 1) {
                    // Single row for this season — use it directly
                    deduplicated.push(yearRows[0]);
                } else {
                    // Multiple rows — look for TOT row first
                    const totRow = yearRows.find(r => 
                        r.TEAM === 'TOT' || r.TM === 'TOT' || r.Team === 'TOT'
                    );
                    
                    if (totRow) {
                        deduplicated.push(totRow);
                    } else {
                        // No TOT row — aggregate the partial rows manually
                        const aggregated = { ...yearRows[0] }; // Start with first row's structure
                        const numericColumns = ['GP', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV',
                                                'FGM', 'FGA', '3P', '3PA', 'FTM', 'FTA', 'MIN',
                                                'OREB', 'DREB', 'PF'];
                        
                        // Zero out numeric columns first, then sum all rows
                        numericColumns.forEach(col => { aggregated[col] = 0; });
                        
                        yearRows.forEach(row => {
                            numericColumns.forEach(col => {
                                const val = parseFloat(row[col]);
                                if (!isNaN(val)) {
                                    aggregated[col] = (aggregated[col] || 0) + val;
                                }
                            });
                        });
                        
                        deduplicated.push(aggregated);
                    }
                }
            }
            
            return deduplicated;
        }

        function getRegularSeasonStat(playerName, metric) {
            const rawRows = playerData.rsStats.filter(row => row.PLAYER === playerName);
            if (rawRows.length === 0) return null;
            const playerRows = deduplicateSeasonRows(rawRows);
            
            // Map metric to column name
            const columnMap = {
                'Points per game': 'PTS / G',
                'Rebounds per game': 'REB / G',
                'Assists per game': 'AST / G',
                'Steals per game': 'STL / G',
                'Blocks per game': 'BLK / G',
                'Field Goal %': 'FG%',
                'Three Point %': '3P%',
                'Free Throw %': 'FT%',
                'Turnovers per game': 'TOV / G',
                'Games': 'GP',
                'Points': 'PTS',
                'Rebounds': 'REB',
                'Assists': 'AST',
                'Steals': 'STL',
                'Blocks': 'BLK',
                'Turnovers': 'TOV',
                '3P%': '3P%'
            };
            
            // Season peak metrics - find highest single-season average
            // IMPORTANT: Calculate from raw totals (STAT / GP) per season,
            // not from a pre-calculated column that may not exist or may have a different name.
            const peakPerGameMetrics = {
                'Points per game peak': 'PTS',
                'Rebounds per game peak': 'REB',
                'Assists per game peak': 'AST',
                'Steals per game peak': 'STL',
                'Blocks per game peak': 'BLK',
                'Turnovers per game peak': 'TOV'
            };
            
            const peakPctMetrics = {
                'Field Goal % peak': { made: 'FGM', att: 'FGA', minAtt: 200 },
                'Three Point % peak': { made: '3P', att: '3PA', minAtt: 50 },
                'Free Throw % peak': { made: 'FTM', att: 'FTA', minAtt: 50 }
            };
            
            const MIN_GAMES_FOR_PEAK = 20;
            
            // For players with only one season, use that season as their peak regardless of games played
            const isSingleSeasonPlayer = playerRows.length === 1;
            
            // Check if this is a per-game peak metric
            if (peakPerGameMetrics[metric]) {
                const statColumn = peakPerGameMetrics[metric];
                let maxValue = -Infinity;
                
                playerRows.forEach(row => {
                    const stat = parseFloat(row[statColumn]);
                    const games = parseFloat(row['GP']);
                    
                    // For single-season players, skip the minimum games requirement
                    const meetsGamesRequirement = isSingleSeasonPlayer || (games >= MIN_GAMES_FOR_PEAK);
                    
                    if (!isNaN(stat) && !isNaN(games) && games > 0 && meetsGamesRequirement) {
                        const perGame = stat / games;
                        if (perGame > maxValue) {
                            maxValue = perGame;
                        }
                    }
                });
                
                return maxValue > -Infinity ? maxValue.toFixed(1) : null;
            }
            
            // Check if this is a percentage peak metric
            if (peakPctMetrics[metric]) {
                const pctInfo = peakPctMetrics[metric];
                let maxPct = -Infinity;
                
                playerRows.forEach(row => {
                    const made = parseFloat(row[pctInfo.made]);
                    const att = parseFloat(row[pctInfo.att]);
                    const games = parseFloat(row['GP']);
                    
                    // For single-season players, relax the minimum attempts and games requirements
                    const meetsRequirements = isSingleSeasonPlayer 
                        ? (att > 0)
                        : (att >= pctInfo.minAtt && !isNaN(games) && games >= MIN_GAMES_FOR_PEAK);
                    
                    // Require minimum attempts AND minimum games to avoid fluky small-sample peaks
                    if (!isNaN(made) && !isNaN(att) && meetsRequirements) {
                        const pct = (made / att) * 100;
                        if (pct > maxPct) {
                            maxPct = pct;
                        }
                    }
                });
                
                return maxPct > -Infinity ? maxPct.toFixed(1) + '%' : null;
            }
            
            const column = columnMap[metric];
            if (!column) return null;
            
            // For per-game stats, calculate total/games
            if (metric.includes('per game')) {
                const baseStatMap = {
                    'Points per game': 'PTS',
                    'Rebounds per game': 'REB',
                    'Assists per game': 'AST',
                    'Steals per game': 'STL',
                    'Blocks per game': 'BLK',
                    'Turnovers per game': 'TOV'
                };
                
                const totalColumn = baseStatMap[metric];
                if (!totalColumn) return null;
                
                let totalStat = 0;
                let totalGames = 0;
                
                playerRows.forEach(row => {
                    const stat = parseFloat(row[totalColumn]);
                    const games = parseFloat(row['GP']);
                    if (!isNaN(stat) && !isNaN(games)) {
                        totalStat += stat;
                        totalGames += games;
                    }
                });
                
                return totalGames > 0 ? (totalStat / totalGames).toFixed(1) : null;
            }
            
            // For percentages, calculate weighted average
            if (metric.includes('%')) {
                const percentageMap = {
                    'Field Goal %': { pct: 'FG%', made: 'FGM', att: 'FGA' },
                    'Three Point %': { pct: '3P%', made: '3P', att: '3PA' },
                    'Free Throw %': { pct: 'FT%', made: 'FTM', att: 'FTA' },
                    '3P%': { pct: '3P%', made: '3P', att: '3PA' }
                };
                
                const pctInfo = percentageMap[metric];
                if (!pctInfo) return null;
                
                let totalMade = 0;
                let totalAtt = 0;
                
                playerRows.forEach(row => {
                    const made = parseFloat(row[pctInfo.made]);
                    const att = parseFloat(row[pctInfo.att]);
                    if (!isNaN(made) && !isNaN(att)) {
                        totalMade += made;
                        totalAtt += att;
                    }
                });
                
                if (totalAtt > 0) {
                    const pct = (totalMade / totalAtt) * 100;
                    return pct.toFixed(1) + '%';
                }
                return null;
            }
            
            // For totals, sum up
            let total = 0;
            playerRows.forEach(row => {
                const val = parseFloat(row[column]);
                if (!isNaN(val)) {
                    total += val;
                }
            });
            return total > 0 ? Math.round(total) : null;
        }

        function getPlayoffStat(playerName, metric) {
            const rawRows = playerData.poStats.filter(row => row.PLAYER === playerName);
            if (rawRows.length === 0) return null;
            const playerRows = deduplicateSeasonRows(rawRows);
            
            // Similar to regular season stats
            const columnMap = {
                'Points per game PO': 'PTS / G',
                'Rebounds per game PO': 'REB / G',
                'Assists per game PO': 'AST / G',
                'Steals per game PO': 'STL / G',
                'Blocks per game PO': 'BLK / G',
                'Field Goal % PO': 'FG%',
                'Three Point % PO': '3P%',
                'Free Throw % PO': 'FT%',
                'Turnovers per game PO': 'TOV / G',
                'Games PO': 'GP',
                'Points PO': 'PTS',
                'Rebounds PO': 'REB',
                'Assists PO': 'AST',
                'Steals PO': 'STL',
                'Blocks PO': 'BLK',
                'Turnovers PO': 'TOV'
            };
            
            // Playoff peak metrics - find highest single-postseason average
            // Calculate from raw totals (STAT / GP) per season, same as regular season peaks.
            const peakPerGameMetricsPO = {
                'Points per game PO peak': 'PTS',
                'Rebounds per game PO peak': 'REB',
                'Assists per game PO peak': 'AST',
                'Steals per game PO peak': 'STL',
                'Blocks per game PO peak': 'BLK',
                'Turnovers per game PO peak': 'TOV'
            };
            
            const peakPctMetricsPO = {
                'Field Goal % PO peak': { made: 'FGM', att: 'FGA', minAtt: 50 },
                'Three Point % PO peak': { made: '3P', att: '3PA', minAtt: 15 },
                'Free Throw % PO peak': { made: 'FTM', att: 'FTA', minAtt: 15 }
            };
            
            const MIN_GAMES_FOR_PO_PEAK = 4; // At least one full series
            
            // For players with only one playoff season, use that season as their peak
            const isSinglePlayoffSeasonPlayer = playerRows.length === 1;
            
            // Check if this is a per-game PO peak metric
            if (peakPerGameMetricsPO[metric]) {
                const statColumn = peakPerGameMetricsPO[metric];
                let maxValue = -Infinity;
                
                playerRows.forEach(row => {
                    const stat = parseFloat(row[statColumn]);
                    const games = parseFloat(row['GP']);
                    
                    // For single-season players, skip the minimum games requirement
                    const meetsGamesRequirement = isSinglePlayoffSeasonPlayer || (games >= MIN_GAMES_FOR_PO_PEAK);
                    
                    if (!isNaN(stat) && !isNaN(games) && games > 0 && meetsGamesRequirement) {
                        const perGame = stat / games;
                        if (perGame > maxValue) {
                            maxValue = perGame;
                        }
                    }
                });
                
                return maxValue > -Infinity ? maxValue.toFixed(1) : null;
            }
            
            // Check if this is a percentage PO peak metric
            if (peakPctMetricsPO[metric]) {
                const pctInfo = peakPctMetricsPO[metric];
                let maxPct = -Infinity;
                
                playerRows.forEach(row => {
                    const made = parseFloat(row[pctInfo.made]);
                    const att = parseFloat(row[pctInfo.att]);
                    const games = parseFloat(row['GP']);
                    
                    // For single-season players, relax the minimum requirements
                    const meetsRequirements = isSinglePlayoffSeasonPlayer
                        ? (att > 0)
                        : (att >= pctInfo.minAtt && !isNaN(games) && games >= MIN_GAMES_FOR_PO_PEAK);
                    
                    if (!isNaN(made) && !isNaN(att) && meetsRequirements) {
                        const pct = (made / att) * 100;
                        if (pct > maxPct) {
                            maxPct = pct;
                        }
                    }
                });
                
                return maxPct > -Infinity ? maxPct.toFixed(1) + '%' : null;
            }
            
            const column = columnMap[metric];
            if (!column) return null;
            
            // For per-game stats, calculate total/games
            if (metric.includes('per game')) {
                const baseStatMap = {
                    'Points per game PO': 'PTS',
                    'Rebounds per game PO': 'REB',
                    'Assists per game PO': 'AST',
                    'Steals per game PO': 'STL',
                    'Blocks per game PO': 'BLK',
                    'Turnovers per game PO': 'TOV'
                };
                
                const totalColumn = baseStatMap[metric];
                if (!totalColumn) return null;
                
                let totalStat = 0;
                let totalGames = 0;
                
                playerRows.forEach(row => {
                    const stat = parseFloat(row[totalColumn]);
                    const games = parseFloat(row['GP']);
                    if (!isNaN(stat) && !isNaN(games)) {
                        totalStat += stat;
                        totalGames += games;
                    }
                });
                
                return totalGames > 0 ? (totalStat / totalGames).toFixed(1) : null;
            }
            
            // For percentages, calculate weighted average
            if (metric.includes('%')) {
                const percentageMap = {
                    'Field Goal % PO': { pct: 'FG%', made: 'FGM', att: 'FGA' },
                    'Three Point % PO': { pct: '3P%', made: '3P', att: '3PA' },
                    'Free Throw % PO': { pct: 'FT%', made: 'FTM', att: 'FTA' }
                };
                
                const pctInfo = percentageMap[metric];
                if (!pctInfo) return null;
                
                let totalMade = 0;
                let totalAtt = 0;
                
                playerRows.forEach(row => {
                    const made = parseFloat(row[pctInfo.made]);
                    const att = parseFloat(row[pctInfo.att]);
                    if (!isNaN(made) && !isNaN(att)) {
                        totalMade += made;
                        totalAtt += att;
                    }
                });
                
                if (totalAtt > 0) {
                    const pct = (totalMade / totalAtt) * 100;
                    return pct.toFixed(1) + '%';
                }
                return null;
            }
            
            // For totals, sum up
            let total = 0;
            playerRows.forEach(row => {
                const val = parseFloat(row[column]);
                if (!isNaN(val)) {
                    total += val;
                }
            });
            return total > 0 ? Math.round(total) : null;
        }

        function getPlayoffSeriesStat(playerName, metric) {
            // Get all playoff rows for this player from poStats
            // Note: poStats uses "PLAYER" field, not "NAME"
            const rawRows = playerData.poStats.filter(row => row.PLAYER === playerName);
            if (rawRows.length === 0) return null;
            const playerRows = deduplicateSeasonRows(rawRows);
            
            // Count each result type
            const resultCounts = {
                'First Round': 0,
                'Conf Semis': 0,
                'Conf Finalist': 0,
                'Finalist': 0,
                'Champion': 0
            };
            
            playerRows.forEach(row => {
                const result = row.RESULT;
                if (resultCounts.hasOwnProperty(result)) {
                    resultCounts[result]++;
                }
            });
            
            // For playoff success metrics, calculate cumulative counts
            // If you reached Champion, you also reached all earlier rounds that year
            if (metric === 'Champion') {
                return resultCounts['Champion'] > 0 ? resultCounts['Champion'] : null;
            }
            
            if (metric === 'Finalist') {
                const count = resultCounts['Finalist'] + resultCounts['Champion'];
                return count > 0 ? count : null;
            }
            
            if (metric === 'Conference Finals') {
                const count = resultCounts['Conf Finalist'] + resultCounts['Finalist'] + resultCounts['Champion'];
                return count > 0 ? count : null;
            }
            
            if (metric === 'Conference Semis') {
                const count = resultCounts['Conf Semis'] + resultCounts['Conf Finalist'] + resultCounts['Finalist'] + resultCounts['Champion'];
                return count > 0 ? count : null;
            }
            
            if (metric === 'First Round') {
                const count = resultCounts['First Round'] + resultCounts['Conf Semis'] + resultCounts['Conf Finalist'] + resultCounts['Finalist'] + resultCounts['Champion'];
                return count > 0 ? count : null;
            }
            
            // For other playoff series stats, use poSeries data
            const playerSeriesRow = playerData.poSeries.find(row => row.NAME === playerName);
            if (!playerSeriesRow) return null;
            
            if (metric === 'Playoff series played') {
                return playerSeriesRow.TOT || null;
            }
            
            if (metric === 'Playoff series won') {
                return playerSeriesRow.W || null;
            }
            
            if (metric === 'Playoff series win %') {
                return playerSeriesRow['% W'] || null;
            }
            
            return null;
        }

        function getSalaryStat(playerName, metric) {
            const playerRows = playerData.salaries.filter(row => row.PLAYER === playerName);
            if (playerRows.length === 0) return null;
            
            // Group by year to avoid counting same salary multiple times in one season
            const salariesByYear = {};
            playerRows.forEach(row => {
                const year = row.YEAR;
                const salary = parseFloat(String(row.SALARY || '').replace(/[$,]/g, ''));
                
                if (!isNaN(salary) && salary > 0 && year) {
                    // Keep track of salaries per year, store in array in case of mid-season trades
                    if (!salariesByYear[year]) {
                        salariesByYear[year] = [];
                    }
                    salariesByYear[year].push(salary);
                }
            });
            
            // For each year, sum all salaries (in case of mid-season trades)
            const yearlyTotals = [];
            for (const year in salariesByYear) {
                const yearTotal = salariesByYear[year].reduce((sum, val) => sum + val, 0);
                yearlyTotals.push(yearTotal);
            }
            
            if (yearlyTotals.length === 0) return null;
            
            if (metric === 'Career earnings') {
                const total = yearlyTotals.reduce((sum, val) => sum + val, 0);
                return '$' + Math.round(total).toLocaleString();
            }
            
            if (metric === 'Average salary') {
                const avg = yearlyTotals.reduce((sum, val) => sum + val, 0) / yearlyTotals.length;
                return '$' + Math.round(avg).toLocaleString();
            }
            
            if (metric === 'Highest salary') {
                const max = Math.max(...yearlyTotals);
                return '$' + Math.round(max).toLocaleString();
            }
            
            if (metric === 'Lowest salary') {
                const min = Math.min(...yearlyTotals);
                return '$' + Math.round(min).toLocaleString();
            }
            
            return null;
        }

        function getCombineStat(playerName, metric) {
            const playerRow = playerData.combine.find(row => row.PLAYER === playerName);
            if (!playerRow) return null;
            
            const columnMap = {
                'Body fat': 'BODY FAT %',
                'Hand size': 'HAND SIZE',
                'Height without shoes': 'HEIGHT W/O SHOES',
                'Standing reach': 'STANDING REACH',
                'Standing reach (inches)': 'STANDING',
                'Weight': 'WEIGHT (LBS)',
                'Wingspan': 'WINGSPAN',
                'Lane agility time': 'LANE AGILITY',
                'Shuttle run': 'SHUTTLE RUN',
                'Three quarter sprint': '3/4 SPRINT',
                'Threequartersprint': '3/4 SPRINT',  // Alternative name
                'Standing vertical leap': 'STANDING VERT',
                'Standingverticalleap': 'STANDING VERT',  // Alternative name
                'Max vertical leap': 'MAX VERT',
                'Maxverticalleap': 'MAX VERT',  // Alternative name
                'Max bench press': 'MAX BENCH',
                'Maxbenchpress': 'MAX BENCH',  // Alternative name
                'Height': 'HEIGHT'
            };
            
            const column = columnMap[metric];
            if (!column) return null;
            
            let value = playerRow[column];
            if (!value || value.trim() === '') return null;
            
            // Convert HEIGHT and STANDING from inches to feet-inches format
            if (metric === 'Height' || metric === 'Standing reach (inches)') {
                const inches = parseFloat(value);
                if (!isNaN(inches)) {
                    const feet = Math.floor(inches / 12);
                    const remainingInches = inches % 12;
                    value = `${feet}' ${remainingInches.toFixed(2)}''`;
                }
            }
            
            return value;
        }

        function getVotingStat(playerName, metric) {
            const playerVotes = playerData.awardVotes.filter(row => row.PLAYER === playerName);
            
            // Best awards ranking - find lowest (best) rank for each award
            const awardRankingMap = {
                'Most Valuable Player': 'MVP',
                'Defensive Player of the Year': 'DPOY',
                'Rookie of the Year': 'ROY',
                'Most Improved Player': 'MIP',
                'Clutch Player of the Year': 'Clutch',
                'Sixth Man of the Year': 'Sixth Man',
                'Hustle Award': 'Hustle'
            };
            
            if (awardRankingMap[metric]) {
                const awardType = awardRankingMap[metric];
                const relevantVotes = playerVotes.filter(row => row.AWARD === awardType);
                
                if (relevantVotes.length === 0) return null;
                
                let bestRank = Infinity;
                relevantVotes.forEach(row => {
                    const rank = parseInt(row.RNK);
                    if (!isNaN(rank) && rank < bestRank) {
                        bestRank = rank;
                    }
                });
                
                return bestRank < Infinity ? bestRank : null;
            }
            
            // Years receiving votes
            const yearsVotesMap = {
                'Years with MVP votes': 'MVP',
                'Years with DPOY votes': 'DPOY',
                'Years with ROY votes': 'ROY',
                'Years with Sixth Man votes': 'Sixth Man',
                'Years with MIP votes': 'MIP',
                'Years with Clutch Player votes': 'Clutch',
                'Years with Hustle Award votes': 'Hustle'
            };
            
            if (yearsVotesMap[metric]) {
                const awardType = yearsVotesMap[metric];
                const relevantVotes = playerVotes.filter(row => row.AWARD === awardType);
                return relevantVotes.length > 0 ? relevantVotes.length : null;
            }
            
            return null;
        }

        function getSneakerStat(playerName, metric) {
            const playerRow = playerData.sneakers.find(row => row.PLAYER === playerName);
            if (!playerRow) return null;
            
            if (metric === 'Number of Shoes') {
                return playerRow.NUMBER_OF_SHOES;
            } else if (metric === 'Years from first to last') {
                // Calculate span: Last year - First year
                const span = playerRow.LAST_YEAR - playerRow.FIRST_YEAR;
                return span;
            }
            
            return null;
        }

        function get2KRating(playerName, metric) {
            const playerRow = playerData.nba2k.find(row => 
                row['Full Name'] === playerName || 
                row['First Name'] + ' ' + row['Last Name'] === playerName
            );
            
            if (!playerRow) return null;
            
            // Collect all ratings
            const ratings = [];
            for (let key in playerRow) {
                if (key.startsWith('2K') || key.startsWith('2k')) {
                    const val = parseInt(playerRow[key]);
                    if (!isNaN(val)) {
                        ratings.push(val);
                    }
                }
            }
            
            if (ratings.length === 0) return null;
            
            if (metric === 'Average career rating') {
                const avg = ratings.reduce((sum, val) => sum + val, 0) / ratings.length;
                return avg.toFixed(1);
            }
            
            if (metric === 'Highest rating') {
                return Math.max(...ratings);
            }
            
            if (metric === 'Lowest rating') {
                return Math.min(...ratings);
            }
            
            return null;
        }

        function getAllStarContestWins(playerName, metric) {
            const playerWins = playerData.allStar.filter(row => 
                row.NAME === playerName && row['WINNER?'] === 'WINNER'
            );
            
            if (metric === 'Dunk Contest') {
                return playerWins.filter(r => r.CONTEST === 'Dunk Contest').length || null;
            } else if (metric === 'Three-Point Contest') {
                return playerWins.filter(r => r.CONTEST === 'Three-Point Contest').length || null;
            } else if (metric === 'Skills Challenge') {
                return playerWins.filter(r => r.CONTEST === 'Skills Challenge').length || null;
            }
            
            return null;
        }


  /* ---------- END VERBATIM EXTRACT ---------- */

  return {
    init: function (db) { playerData = db; },
    compare: function (p1, p2) { return performComparison(p1, p2); },
    parseNumericValue: parseNumericValue,
    getPlayerStat: function (name, metric, src) { return getPlayerStat(name, metric, src); }
  };
});
