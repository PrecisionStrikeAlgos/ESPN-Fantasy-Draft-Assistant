const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Store connection info
let leagueConfig = null;

// ESPN API Base URL (Updated)
const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

// Helper function to make ESPN API requests
async function makeESPNRequest(endpoint, config, params = {}) {
    const url = `${ESPN_BASE_URL}${endpoint}`;
    
    const headers = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    
    // Add authentication for private leagues
    if (config && config.espnS2 && config.swid) {
        headers['Cookie'] = `espn_s2=${config.espnS2}; SWID=${config.swid}`;
    }
    
    console.log(`ðŸ”— Making request to: ${url}`);
    console.log(`ðŸ“‹ Params:`, params);
    
    try {
        const response = await axios.get(url, {
            headers,
            params,
            timeout: 15000
        });
        
        return response.data;
    } catch (error) {
        console.error(`âŒ ESPN API Error:`, error.response?.status, error.response?.statusText);
        if (error.response?.data) {
            console.error('Error details:', error.response.data);
        }
        throw error;
    }
}

// API Routes
app.post('/api/connect', async (req, res) => {
    try {
        const { leagueId, seasonId, espnS2, swid } = req.body;
        
        console.log(`ðŸˆ Connecting to ESPN League ${leagueId} for season ${seasonId}`);
        
        leagueConfig = {
            leagueId: parseInt(leagueId),
            seasonId: parseInt(seasonId),
            espnS2: espnS2 || null,
            swid: swid || null
        };
        
        if (espnS2 && swid) {
            console.log('ðŸ” Private league cookies set');
        }
        
        // Test connection by getting league info with multiple views
        const endpoint = `/seasons/${seasonId}/segments/0/leagues/${leagueId}`;
        const params = { 
            view: ['mSettings', 'mTeam', 'mRoster'].join(',')
        };
        
        const leagueData = await makeESPNRequest(endpoint, leagueConfig, params);
        
        console.log(`âœ… Successfully connected to: ${leagueData.settings?.name || 'ESPN League'}`);
        console.log(`ðŸ“Š Teams found: ${leagueData.teams?.length || 0}`);
        
        res.json({
            success: true,
            league: {
                name: leagueData.settings?.name || 'ESPN League',
                teams: leagueData.teams?.length || 0,
                scoringType: leagueData.settings?.scoringSettings?.scoringType === 0 ? 'Standard' : 'PPR',
                seasonId: seasonId,
                leagueId: leagueId,
                draftDate: leagueData.settings?.draftSettings?.date || null,
                teamData: leagueData.teams?.map(team => ({
                    id: team.id,
                    name: `${team.location} ${team.nickname}`,
                    owner: team.primaryOwner,
                    roster: team.roster?.entries || []
                })) || []
            }
        });
        
    } catch (error) {
        console.error('âŒ ESPN Connection Error:', error.message);
        
        let errorMessage = `Failed to connect to ESPN League ${req.body.leagueId}.`;
        
        if (error.response?.status === 404) {
            errorMessage += ' League not found. Check your League ID.';
        } else if (error.response?.status === 401) {
            errorMessage += ' Access denied. For private leagues, verify your ESPN_S2 and SWID cookies.';
        } else if (error.response?.status === 500) {
            errorMessage += ' ESPN server error. Try again in a few minutes.';
        } else {
            errorMessage += ' Check your League ID and credentials.';
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
});

// CORRECT IMPLEMENTATION based on official ESPN API docs
// Replace your /api/players/:seasonId with this:

app.get('/api/players/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸ” Fetching players using getFreeAgents equivalent for season ${seasonId}`);
        
        if (!leagueConfig || !leagueConfig.leagueId) {
            return res.status(400).json({ error: 'Must connect to league first' });
        }
        
        // Use getFreeAgents equivalent - this should return FreeAgentPlayerMap objects
        const freeAgentsUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/segments/0/leagues/${leagueConfig.leagueId}`;
        
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        
        if (leagueConfig.espnS2 && leagueConfig.swid) {
            headers['Cookie'] = `espn_s2=${leagueConfig.espnS2}; SWID=${leagueConfig.swid}`;
        }
        
        console.log(`ðŸ“¡ Making enhanced getFreeAgents API call to: ${freeAgentsUrl}`);
        
        // Try multiple approaches to get the full player pool
        let allPlayersData = [];

        // Approach 1: Try with X-Fantasy-Filter for more players
        try {
            const enhancedHeaders = {
                ...headers,
                'X-Fantasy-Filter': JSON.stringify({
                    players: {
                        limit: 2000,
                        sortPercOwned: {
                            sortPriority: 1,
                            sortAsc: false
                        }
                    }
                })
            };
            
            const response1 = await axios.get(freeAgentsUrl, {
                headers: enhancedHeaders,
                params: {
                    view: 'kona_player_info',
                    scoringPeriodId: 0
                },
                timeout: 20000
            });
            
            if (response1.data && response1.data.players) {
                allPlayersData = response1.data.players;
                console.log(`âœ… Enhanced approach: ${allPlayersData.length} players`);
            }
        } catch (error) {
            console.log(`âš ï¸ Enhanced approach failed: ${error.message}`);
        }

        // Approach 2: If we still don't have enough players, try the original working endpoint and merge
        if (allPlayersData.length < 500) {
            try {
                console.log(`ðŸ”„ Getting additional players from original endpoint...`);
                
                const fallbackUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
                const fallbackHeaders = {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'X-Fantasy-Filter': JSON.stringify({
                        players: {
                            limit: 2000,
                            sortPercOwned: {
                                sortPriority: 1,
                                sortAsc: false
                            }
                        }
                    })
                };
                
                const fallbackResponse = await axios.get(fallbackUrl, {
                    headers: fallbackHeaders,
                    params: { view: 'players_wl' },
                    timeout: 20000
                });
                
                if (fallbackResponse.data && Array.isArray(fallbackResponse.data)) {
                    const fallbackPlayers = fallbackResponse.data;
                    console.log(`âœ… Fallback players: ${fallbackPlayers.length}`);
                    
                    // Merge players - use enhanced data where available, fallback for others
                    const enhancedPlayerIds = new Set(allPlayersData.map(p => (p.player || p).id));
                    
                    fallbackPlayers.forEach(fallbackPlayer => {
                        if (!enhancedPlayerIds.has(fallbackPlayer.id)) {
                            // Add fallback player in same format as enhanced players
                            allPlayersData.push({
                                player: fallbackPlayer,
                                // Add minimal wrapper to match enhanced format
                                id: fallbackPlayer.id,
                                dataSource: 'fallback'
                            });
                        }
                    });
                    
                    console.log(`ðŸ”— Merged total: ${allPlayersData.length} players`);
                }
                
            } catch (fallbackError) {
                console.log(`âŒ Fallback also failed: ${fallbackError.message}`);
            }
        }

        // Use the merged player data
        let playersData = allPlayersData;
        
        if (playersData.length === 0) {
            throw new Error('No players data retrieved from any source');
        }
        
        if (playersData.length === 0) {
            throw new Error('No players data retrieved');
        }
        
        console.log(`ðŸ” Processing ${playersData.length} players...`);
        
        // Sample player structure for debugging
        if (playersData[0]) {
            console.log(`ðŸ“Š Sample player structure:`, JSON.stringify(playersData[0], null, 2).substring(0, 500));
        }
        
        // Process players according to FreeAgentPlayerMap structure from docs
        const FANTASY_POSITIONS = [1, 2, 3, 4, 5, 16];
        
        const players = playersData.map(playerEntry => {
            // Handle both direct player objects and wrapped player objects
            const player = playerEntry.player || playerEntry;
            
            if (!player || !player.fullName) return null;
            
            // Extract data according to official PlayerMap structure
            let adp = 999;
            let projectedPoints = 0;
            let ownership = 0;
            
            // According to docs, averageDraftPosition should be directly on player
            if (player.averageDraftPosition) {
                adp = player.averageDraftPosition;
            } else if (player.ownership && player.ownership.averageDraftPosition) {
                adp = player.ownership.averageDraftPosition;
            }
            
            // According to docs, percentOwned should be directly on player  
            if (player.percentOwned) {
                ownership = player.percentOwned;
            } else if (player.ownership && player.ownership.percentOwned) {
                ownership = player.ownership.percentOwned;
            }
            
            // According to docs, projectedRawStats should contain projections
            if (playerEntry.projectedRawStats && playerEntry.projectedRawStats.appliedTotal) {
                projectedPoints = playerEntry.projectedRawStats.appliedTotal;
            } else if (player.projectedRawStats && player.projectedRawStats.appliedTotal) {
                projectedPoints = player.projectedRawStats.appliedTotal;
            } else if (player.stats && Array.isArray(player.stats)) {
                // Look for projected stats in stats array
                const projectedStat = player.stats.find(stat => 
                    stat.seasonId === seasonId && stat.statSourceId === 1
                );
                if (projectedStat && projectedStat.appliedTotal) {
                    projectedPoints = projectedStat.appliedTotal;
                }
            }
            
            return {
                id: player.id,
                name: player.fullName,
                team: player.proTeamAbbreviation || getTeamAbbr(player.proTeamId),
                position: player.defaultPosition || getPositionName(player.defaultPositionId),
                positionId: player.defaultPositionId,
                
                // REAL DATA from ESPN API according to docs
                projectedPoints: projectedPoints,
                ownership: ownership,
                adp: adp,
                percentStarted: player.percentStarted || (player.ownership && player.ownership.percentStarted) || 0,
                
                // Status according to docs
                eligiblePositions: player.eligiblePositions || (player.eligibleSlots && player.eligibleSlots.map(slot => getPositionName(slot)).filter(pos => pos !== 'Unknown')) || [getPositionName(player.defaultPositionId)],
                availabilityStatus: player.availabilityStatus || 'FREEAGENT',
                isDroppable: player.isDroppable !== false,
                isInjured: player.isInjured === true,
                injuryStatus: player.injuryStatus || 'ACTIVE',
                
                // Additional info
                jerseyNumber: player.jerseyNumber,
                
                // Tier classification based on ADP
                tier: adp <= 24 ? 'elite' : adp <= 60 ? 'starter' : adp <= 120 ? 'depth' : adp <= 180 ? 'popular' : 'sleeper',
                
                // Data quality indicators  
                hasRealADP: adp > 0 && adp < 500,
                hasRealProjections: projectedPoints > 0,
                
                // Debug info
                rawPlayer: player,
                rawPlayerEntry: playerEntry,
                dataSource: 'getFreeAgents'
            };
        }).filter(player => {
            if (!player || !player.name || player.name.length < 2) return false;
            if (!FANTASY_POSITIONS.includes(player.positionId)) return false;
            
            // Keep all fantasy-relevant players
            const hasSignificantOwnership = player.ownership > 1;
            const hasValidADP = player.adp > 0 && player.adp < 400;
            const hasProjections = player.projectedPoints > 0;
            const isFantasyRelevant = player.ownership > 0 || player.adp < 500;
            
            return hasSignificantOwnership || hasValidADP || hasProjections || isFantasyRelevant;
        }).sort((a, b) => {
            // Sort by ADP first if available
            if (a.hasRealADP && b.hasRealADP) {
                return a.adp - b.adp;
            }
            if (a.hasRealADP && !b.hasRealADP) return -1;
            if (!a.hasRealADP && b.hasRealADP) return 1;
            
            // Then by ownership
            if (a.ownership !== b.ownership) {
                return b.ownership - a.ownership;
            }
            
            // Finally by projections
            return b.projectedPoints - a.projectedPoints;
        });
        
        console.log(`ðŸ“Š Processed ${players.length} fantasy players`);
        
        // Show data quality stats
        const dataQuality = {
            totalPlayers: players.length,
            playersWithRealADP: players.filter(p => p.hasRealADP).length,
            playersWithRealProjections: players.filter(p => p.hasRealProjections).length,
            averageADP: players.filter(p => p.hasRealADP).reduce((sum, p) => sum + p.adp, 0) / players.filter(p => p.hasRealADP).length || 0,
            averageProjections: players.filter(p => p.hasRealProjections).reduce((sum, p) => sum + p.projectedPoints, 0) / players.filter(p => p.hasRealProjections).length || 0
        };
        
        console.log(`ðŸ“ˆ Data quality:`, dataQuality);
        
        // Show top 10 for debugging
        console.log('ðŸ† Top 10 players:');
        players.slice(0, 10).forEach((player, i) => {
            console.log(`${i+1}. ${player.name} - ADP: ${player.adp} (${player.hasRealADP ? 'REAL' : 'fallback'}), Proj: ${player.projectedPoints} (${player.hasRealProjections ? 'REAL' : 'fallback'}), Own: ${player.ownership}%`);
        });
        
        res.json(players);
        
    } catch (error) {
        console.error('âŒ Error fetching players:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch players from ESPN API',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ADD A SIMPLE TEST ENDPOINT TO CHECK DATA STRUCTURE
app.get('/api/test-free-agents/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        
        if (!leagueConfig || !leagueConfig.leagueId) {
            return res.status(400).json({ error: 'Must connect to league first' });
        }
        
        const freeAgentsUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/segments/0/leagues/${leagueConfig.leagueId}`;
        
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        
        if (leagueConfig.espnS2 && leagueConfig.swid) {
            headers['Cookie'] = `espn_s2=${leagueConfig.espnS2}; SWID=${leagueConfig.swid}`;
        }
        
        const response = await axios.get(freeAgentsUrl, {
            headers,
            params: {
                view: 'kona_player_info',
                scoringPeriodId: 0
            },
            timeout: 15000
        });
        
        res.json({
            success: true,
            responseKeys: Object.keys(response.data || {}),
            sampleData: response.data,
            playerCount: response.data.players ? response.data.players.length : 0,
            samplePlayer: response.data.players ? response.data.players[0] : null
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            details: 'Test free agents endpoint failed'
        });
    }
});

app.get('/api/teams/:seasonId', async (req, res) => {
    try {
        if (!leagueConfig) {
            return res.status(400).json({ error: 'Not connected to ESPN league' });
        }
        
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸ‘¥ Fetching teams for season ${seasonId}`);
        
        const endpoint = `/seasons/${seasonId}/segments/0/leagues/${leagueConfig.leagueId}`;
        const params = { view: ['mTeam', 'mRoster'].join(',') };
        
        const data = await makeESPNRequest(endpoint, leagueConfig, params);
        
        const teams = (data.teams || []).map(team => ({
            id: team.id,
            name: `${team.location} ${team.nickname}`,
            owner: team.primaryOwner,
            record: team.record?.overall || { wins: 0, losses: 0, ties: 0 },
            roster: team.roster?.entries?.map(entry => ({
                playerId: entry.playerId,
                playerName: entry.playerPoolEntry?.player?.fullName || 'Unknown',
                position: getPositionName(entry.playerPoolEntry?.player?.defaultPositionId),
                lineupSlotId: entry.lineupSlotId
            })) || []
        }));
        
        res.json(teams);
        
    } catch (error) {
        console.error('âŒ Error fetching teams:', error.message);
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});

app.get('/api/draft/:seasonId', async (req, res) => {
    try {
        if (!leagueConfig) {
            return res.status(400).json({ error: 'Not connected to ESPN league' });
        }
        
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸˆ Fetching draft info for season ${seasonId}`);
        
        const endpoint = `/seasons/${seasonId}/segments/0/leagues/${leagueConfig.leagueId}`;
        const params = { view: 'mDraftDetail' };
        
        const data = await makeESPNRequest(endpoint, leagueConfig, params);
        
        const draftInfo = {
            drafted: data.draftDetail?.drafted || false,
            picks: data.draftDetail?.picks?.map(pick => ({
                playerId: pick.playerId,
                teamId: pick.teamId,
                roundId: pick.roundId,
                roundPickNumber: pick.roundPickNumber,
                overallPickNumber: pick.overallPickNumber,
                playerName: pick.playerPoolEntry?.player?.fullName || 'Unknown',
                position: getPositionName(pick.playerPoolEntry?.player?.defaultPositionId),
                team: getTeamAbbr(pick.playerPoolEntry?.player?.proTeamId)
            })) || []
        };
        
        res.json(draftInfo);
        
    } catch (error) {
        console.error('âŒ Error fetching draft info:', error.message);
        res.status(500).json({ error: 'Failed to fetch draft information' });
    }
});

// Test endpoint to debug player issues
app.get('/api/debug/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸ§ª Debug endpoint for season ${seasonId}`);
        
        const debugInfo = {
            endpoints: [],
            totalPlayers: 0,
            positionBreakdown: {},
            samplePlayers: []
        };
        
        // Test 1: Free agents endpoint
        try {
            const freeAgentsUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Fantasy-Filter': JSON.stringify({
                    players: { limit: 50 }
                })
            };
            
            const response = await axios.get(freeAgentsUrl, {
                headers,
                params: { view: 'players_wl' },
                timeout: 10000
            });
            
            debugInfo.endpoints.push({
                name: 'Free Agents',
                url: freeAgentsUrl,
                status: 'SUCCESS',
                playerCount: response.data?.length || 0,
                samplePlayer: response.data?.[0]?.player?.fullName || 'None'
            });
            
            if (response.data && response.data.length > 0) {
                debugInfo.totalPlayers += response.data.length;
                
                // Get position breakdown
                response.data.forEach(entry => {
                    const player = entry.player || entry;
                    const position = getPositionName(player.defaultPositionId);
                    debugInfo.positionBreakdown[position] = (debugInfo.positionBreakdown[position] || 0) + 1;
                });
                
                // Get sample players
                debugInfo.samplePlayers = response.data.slice(0, 5).map(entry => {
                    const player = entry.player || entry;
                    return {
                        name: player.fullName,
                        position: getPositionName(player.defaultPositionId),
                        positionId: player.defaultPositionId,
                        team: getTeamAbbr(player.proTeamId)
                    };
                });
            }
            
        } catch (error) {
            debugInfo.endpoints.push({
                name: 'Free Agents',
                status: 'FAILED',
                error: error.message
            });
        }
        
        res.json(debugInfo);
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            message: 'Debug endpoint failed'
        });
    }
});

// ADD THIS TO YOUR EXISTING server.js file
// Place it anywhere with your other app.get() routes

// TEST DIFFERENT ESPN ENDPOINTS TO FIND BETTER DATA
app.get('/api/test-players/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸ§ª Testing different ESPN player endpoints for season ${seasonId}`);
        
        const testResults = {
            endpoints: [],
            bestEndpoint: null,
            dataComparison: {}
        };

        // Test 1: Current working endpoint
        try {
            console.log('ðŸ“¡ Testing current players endpoint...');
            const currentUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
            const currentHeaders = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Fantasy-Filter': JSON.stringify({
                    players: {
                        limit: 100,
                        sortPercOwned: {
                            sortPriority: 1,
                            sortAsc: false
                        }
                    }
                })
            };
            
            const currentResponse = await axios.get(currentUrl, {
                headers: currentHeaders,
                params: { view: 'players_wl' },
                timeout: 10000
            });
            
            testResults.endpoints.push({
                name: 'Current Working',
                url: currentUrl,
                view: 'players_wl',
                status: 'SUCCESS',
                playerCount: currentResponse.data?.length || 0,
                samplePlayer: currentResponse.data?.[0],
                hasADP: currentResponse.data?.[0]?.ownership?.averageDraftPosition > 0,
                hasProjections: currentResponse.data?.[0]?.stats?.[0]?.appliedTotal > 0
            });
            
        } catch (error) {
            testResults.endpoints.push({
                name: 'Current Working',
                status: 'FAILED',
                error: error.message
            });
        }

        // Test 2: Try sortAdp filter
        try {
            console.log('ðŸ“¡ Testing sortAdp filter...');
            const adpUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
            const adpHeaders = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Fantasy-Filter': JSON.stringify({
                    players: {
                        limit: 100,
                        sortAdp: {
                            sortPriority: 1,
                            sortAsc: true
                        }
                    }
                })
            };
            
            const adpResponse = await axios.get(adpUrl, {
                headers: adpHeaders,
                params: { view: 'players_wl' },
                timeout: 10000
            });
            
            testResults.endpoints.push({
                name: 'Sort by ADP',
                url: adpUrl,
                view: 'players_wl',
                filter: 'sortAdp',
                status: 'SUCCESS',
                playerCount: adpResponse.data?.length || 0,
                samplePlayer: adpResponse.data?.[0],
                hasADP: adpResponse.data?.[0]?.ownership?.averageDraftPosition > 0,
                hasProjections: adpResponse.data?.[0]?.stats?.[0]?.appliedTotal > 0
            });
            
        } catch (error) {
            testResults.endpoints.push({
                name: 'Sort by ADP',
                status: 'FAILED',
                error: error.message
            });
        }

        // Test 3: Try mProjections view
        try {
            console.log('ðŸ“¡ Testing mProjections view...');
            const projUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
            const projHeaders = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Fantasy-Filter': JSON.stringify({
                    players: {
                        limit: 100,
                        sortPercOwned: {
                            sortPriority: 1,
                            sortAsc: false
                        }
                    }
                })
            };
            
            const projResponse = await axios.get(projUrl, {
                headers: projHeaders,
                params: { view: ['players_wl', 'mProjections'].join(',') },
                timeout: 10000
            });
            
            testResults.endpoints.push({
                name: 'With mProjections',
                url: projUrl,
                view: 'players_wl,mProjections',
                status: 'SUCCESS',
                playerCount: projResponse.data?.length || 0,
                samplePlayer: projResponse.data?.[0],
                hasADP: projResponse.data?.[0]?.ownership?.averageDraftPosition > 0,
                hasProjections: projResponse.data?.[0]?.stats?.[0]?.appliedTotal > 0,
                rawStats: projResponse.data?.[0]?.stats
            });
            
        } catch (error) {
            testResults.endpoints.push({
                name: 'With mProjections',
                status: 'FAILED',
                error: error.message
            });
        }

        // Test 4: Try 2024 data as fallback
        if (seasonId === 2025) {
            try {
                console.log('ðŸ“¡ Testing 2024 fallback data...');
                const fallbackUrl = `${ESPN_BASE_URL}/seasons/2024/players`;
                const fallbackHeaders = {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'X-Fantasy-Filter': JSON.stringify({
                        players: {
                            limit: 100,
                            sortAdp: {
                                sortPriority: 1,
                                sortAsc: true
                            }
                        }
                    })
                };
                
                const fallbackResponse = await axios.get(fallbackUrl, {
                    headers: fallbackHeaders,
                    params: { view: 'players_wl' },
                    timeout: 10000
                });
                
                testResults.endpoints.push({
                    name: '2024 Fallback Data',
                    url: fallbackUrl,
                    view: 'players_wl',
                    status: 'SUCCESS',
                    playerCount: fallbackResponse.data?.length || 0,
                    samplePlayer: fallbackResponse.data?.[0],
                    hasADP: fallbackResponse.data?.[0]?.ownership?.averageDraftPosition > 0,
                    hasProjections: fallbackResponse.data?.[0]?.stats?.[0]?.appliedTotal > 0
                });
                
            } catch (error) {
                testResults.endpoints.push({
                    name: '2024 Fallback Data',
                    status: 'FAILED',
                    error: error.message
                });
            }
        }

        // Determine best endpoint
        const successfulEndpoints = testResults.endpoints.filter(ep => ep.status === 'SUCCESS');
        if (successfulEndpoints.length > 0) {
            testResults.bestEndpoint = successfulEndpoints.reduce((best, current) => {
                const currentScore = (current.hasADP ? 2 : 0) + (current.hasProjections ? 2 : 0) + (current.playerCount > 0 ? 1 : 0);
                const bestScore = (best.hasADP ? 2 : 0) + (best.hasProjections ? 2 : 0) + (best.playerCount > 0 ? 1 : 0);
                return currentScore > bestScore ? current : best;
            });
        }

        console.log(`âœ… API testing complete. Best endpoint: ${testResults.bestEndpoint?.name || 'None'}`);
        
        res.json(testResults);
        
    } catch (error) {
        console.error('âŒ API testing failed:', error);
        res.status(500).json({
            error: 'API testing failed',
            details: error.message
        });
    }
});

// ADD THIS NEW ENDPOINT TO YOUR server.js
// This uses ESPN's getFreeAgents API which should have ADP and projection data

app.get('/api/players-free-agents/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸ” Fetching free agents for season ${seasonId}`);
        
        // Use ESPN's getFreeAgents endpoint which should have complete data
        const freeAgentsUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/segments/0/leagues/${leagueConfig?.leagueId || 123456}`;
        
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        
        // Add authentication if available
        if (leagueConfig?.espnS2 && leagueConfig?.swid) {
            headers['Cookie'] = `espn_s2=${leagueConfig.espnS2}; SWID=${leagueConfig.swid}`;
        }
        
        // Try the getFreeAgents equivalent API call
        const params = {
            view: ['kona_player_info', 'players_wl', 'mDraftDetail'].join(','),
            scoringPeriodId: 0  // 0 = preseason, should have all players
        };
        
        console.log(`ðŸ“¡ Making getFreeAgents API call...`);
        console.log(`ðŸ”— URL: ${freeAgentsUrl}`);
        console.log(`ðŸ“‹ Params:`, params);
        
        const response = await axios.get(freeAgentsUrl, {
            headers,
            params,
            timeout: 20000
        });
        
        console.log(`âœ… getFreeAgents response received`);
        console.log(`ðŸ“Š Response keys:`, Object.keys(response.data || {}));
        
        // Check different possible data locations
        let playersData = [];
        
        if (response.data.players) {
            playersData = response.data.players;
            console.log(`ðŸ“¦ Found players in response.data.players: ${playersData.length}`);
        } else if (response.data.teams) {
            // Sometimes players are nested in team rosters
            response.data.teams.forEach(team => {
                if (team.roster && team.roster.entries) {
                    team.roster.entries.forEach(entry => {
                        if (entry.playerPoolEntry && entry.playerPoolEntry.player) {
                            playersData.push(entry.playerPoolEntry.player);
                        }
                    });
                }
            });
            console.log(`ðŸ“¦ Found players in team rosters: ${playersData.length}`);
        }
        
        if (playersData.length === 0) {
            console.log(`âš ï¸ No players found, checking all response data...`);
            console.log(`ðŸ“Š Full response structure:`, JSON.stringify(response.data, null, 2).substring(0, 1000));
            throw new Error('No players found in getFreeAgents response');
        }
        
        console.log(`ðŸ” Sample player structure:`, JSON.stringify(playersData[0], null, 2));
        
        res.json({
            success: true,
            playerCount: playersData.length,
            samplePlayer: playersData[0],
            dataStructure: Object.keys(response.data || {}),
            rawResponse: response.data
        });
        
    } catch (error) {
        console.error('âŒ getFreeAgents API failed:', error.message);
        res.status(500).json({
            error: 'Failed to fetch free agents data',
            details: error.message
        });
    }
});

// ENHANCED VERSION - Try multiple ESPN endpoints for complete data
app.get('/api/players-enhanced-espn/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸ” Enhanced ESPN player fetch for season ${seasonId}`);
        
        if (!leagueConfig || !leagueConfig.leagueId) {
            return res.status(400).json({ error: 'Must connect to league first' });
        }
        
        let allPlayersData = [];
        
        // Method 1: Try kona_player_info with league context
        try {
            console.log(`ðŸ“¡ Method 1: kona_player_info with league context...`);
            
            const leagueUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/segments/0/leagues/${leagueConfig.leagueId}`;
            const headers = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            };
            
            if (leagueConfig.espnS2 && leagueConfig.swid) {
                headers['Cookie'] = `espn_s2=${leagueConfig.espnS2}; SWID=${leagueConfig.swid}`;
            }
            
            const response = await axios.get(leagueUrl, {
                headers,
                params: {
                    view: 'kona_player_info',
                    scoringPeriodId: 1  // Week 1 should have projections
                },
                timeout: 15000
            });
            
            if (response.data && response.data.players) {
                allPlayersData = response.data.players;
                console.log(`âœ… Method 1 success: ${allPlayersData.length} players`);
            } else {
                console.log(`âš ï¸ Method 1: No players in response`);
            }
            
        } catch (error) {
            console.log(`âŒ Method 1 failed: ${error.message}`);
        }
        
        // Method 2: Try specific X-Fantasy-Filter for projections
        if (allPlayersData.length === 0) {
            try {
                console.log(`ðŸ“¡ Method 2: X-Fantasy-Filter for projections...`);
                
                const playersUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
                const headers = {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'X-Fantasy-Filter': JSON.stringify({
                        players: {
                            limit: 1000,
                            sortDraftRanks: {
                                sortPriority: 1,
                                sortAsc: true,
                                value: "STANDARD"
                            },
                            filterStatsForExternalIds: {
                                value: [2025]  // Season ID
                            }
                        }
                    })
                };
                
                const response = await axios.get(playersUrl, {
                    headers,
                    params: {
                        view: ['kona_player_info', 'mProjections', 'mDraftDetail'].join(',')
                    },
                    timeout: 15000
                });
                
                if (response.data && Array.isArray(response.data)) {
                    allPlayersData = response.data;
                    console.log(`âœ… Method 2 success: ${allPlayersData.length} players`);
                } else {
                    console.log(`âš ï¸ Method 2: Invalid response structure`);
                }
                
            } catch (error) {
                console.log(`âŒ Method 2 failed: ${error.message}`);
            }
        }
        
        // Method 3: Try the working endpoint but with different views
        if (allPlayersData.length === 0) {
            try {
                console.log(`ðŸ“¡ Method 3: Working endpoint with enhanced views...`);
                
                const playersUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
                const headers = {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'X-Fantasy-Filter': JSON.stringify({
                        players: {
                            limit: 2000,
                            sortPercOwned: {
                                sortPriority: 1,
                                sortAsc: false
                            }
                        }
                    })
                };
                
                const response = await axios.get(playersUrl, {
                    headers,
                    params: {
                        view: ['players_wl', 'kona_player_info', 'mStats', 'mProjections'].join(',')
                    },
                    timeout: 20000
                });
                
                if (response.data && Array.isArray(response.data)) {
                    allPlayersData = response.data;
                    console.log(`âœ… Method 3 success: ${allPlayersData.length} players`);
                } else {
                    console.log(`âš ï¸ Method 3: Invalid response structure`);
                }
                
            } catch (error) {
                console.log(`âŒ Method 3 failed: ${error.message}`);
            }
        }
        
        if (allPlayersData.length === 0) {
            throw new Error('All methods failed to retrieve player data');
        }
        
        // Analyze the data structure we received
        console.log(`ðŸ” Analyzing player data structure...`);
        const samplePlayer = allPlayersData[0];
        console.log(`ðŸ“Š Sample player keys:`, Object.keys(samplePlayer));
        
        if (samplePlayer.ownership) {
            console.log(`ðŸ’° Ownership structure:`, Object.keys(samplePlayer.ownership));
        }
        
        if (samplePlayer.stats) {
            console.log(`ðŸ“ˆ Stats structure:`, samplePlayer.stats.map(stat => ({
                sourceId: stat.statSourceId,
                sourceName: stat.statSourceId === 0 ? 'Actual' : stat.statSourceId === 1 ? 'Projected' : 'Unknown',
                appliedTotal: stat.appliedTotal,
                keys: Object.keys(stat)
            })));
        }
        
        // Process players with enhanced data extraction
        const FANTASY_POSITIONS = [1, 2, 3, 4, 5, 16];
        
        const enhancedPlayers = allPlayersData.map(player => {
            if (!player || !player.fullName) return null;
            
            // Extract ADP from ownership
            let adp = 999;
            if (player.ownership && player.ownership.averageDraftPosition) {
                adp = player.ownership.averageDraftPosition;
            }
            
            // Extract projections from stats
            let projectedPoints = 0;
            if (player.stats && Array.isArray(player.stats)) {
                // Look for projected stats (statSourceId = 1)
                const projectedStat = player.stats.find(stat => stat.statSourceId === 1);
                if (projectedStat && projectedStat.appliedTotal) {
                    projectedPoints = projectedStat.appliedTotal;
                }
            }
            
            return {
                id: player.id,
                name: player.fullName,
                team: player.proTeamAbbreviation || getTeamAbbr(player.proTeamId),
                position: player.defaultPosition || getPositionName(player.defaultPositionId),
                positionId: player.defaultPositionId,
                
                // Enhanced data
                projectedPoints: projectedPoints,
                ownership: player.ownership?.percentOwned || 0,
                adp: adp,
                percentStarted: player.ownership?.percentStarted || 0,
                
                // Status
                eligiblePositions: player.eligibleSlots?.map(slot => getPositionName(slot)).filter(pos => pos !== 'Unknown') || [getPositionName(player.defaultPositionId)],
                availabilityStatus: player.availabilityStatus || 'FREEAGENT',
                isDroppable: player.droppable !== false,
                isInjured: player.isInjured === true,
                injuryStatus: player.injuryStatus || 'ACTIVE',
                
                // Data quality flags
                hasRealADP: adp > 0 && adp < 999,
                hasRealProjections: projectedPoints > 0,
                
                // Raw data for debugging
                rawOwnership: player.ownership,
                rawStats: player.stats
            };
        }).filter(player => {
            if (!player || !player.name || player.name.length < 2) return false;
            if (!FANTASY_POSITIONS.includes(player.positionId)) return false;
            
            const hasSignificantOwnership = player.ownership > 5;
            const hasValidADP = player.adp > 0 && player.adp < 300;
            const hasProjections = player.projectedPoints > 0;
            const isRostered = player.availabilityStatus === 'ONTEAM';
            
            return hasSignificantOwnership || hasValidADP || hasProjections || isRostered;
        }).sort((a, b) => {
            // Sort by ADP if available, then ownership, then projections
            if (a.hasRealADP && b.hasRealADP) {
                return a.adp - b.adp;
            }
            if (a.hasRealADP && !b.hasRealADP) return -1;
            if (!a.hasRealADP && b.hasRealADP) return 1;
            
            if (a.ownership !== b.ownership) {
                return b.ownership - a.ownership;
            }
            
            return b.projectedPoints - a.projectedPoints;
        });
        
        // Data quality summary
        const dataQuality = {
            totalPlayers: enhancedPlayers.length,
            playersWithRealADP: enhancedPlayers.filter(p => p.hasRealADP).length,
            playersWithRealProjections: enhancedPlayers.filter(p => p.hasRealProjections).length,
            topPlayersWithADP: enhancedPlayers.slice(0, 10).map(p => ({ 
                name: p.name, 
                adp: p.adp, 
                projections: p.projectedPoints,
                hasRealADP: p.hasRealADP,
                hasRealProjections: p.hasRealProjections
            }))
        };
        
        console.log(`âœ… Enhanced processing complete`);
        console.log(`ðŸ“Š Data quality:`, dataQuality);
        
        res.json({
            players: enhancedPlayers,
            dataQuality: dataQuality,
            samplePlayerStructure: samplePlayer
        });
        
    } catch (error) {
        console.error('âŒ Enhanced ESPN fetch failed:', error.message);
        res.status(500).json({
            error: 'Failed to fetch enhanced player data',
            details: error.message
        });
    }
});


// CORRECT IMPLEMENTATION based on official ESPN API docs
// Replace your /api/players/:seasonId with this:

app.get('/api/players/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        console.log(`ðŸ” Fetching players using getFreeAgents equivalent for season ${seasonId}`);
        
        if (!leagueConfig || !leagueConfig.leagueId) {
            return res.status(400).json({ error: 'Must connect to league first' });
        }
        
        // Use getFreeAgents equivalent - this should return FreeAgentPlayerMap objects
        const freeAgentsUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/segments/0/leagues/${leagueConfig.leagueId}`;
        
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        
        if (leagueConfig.espnS2 && leagueConfig.swid) {
            headers['Cookie'] = `espn_s2=${leagueConfig.espnS2}; SWID=${leagueConfig.swid}`;
        }
        
        console.log(`ðŸ“¡ Making getFreeAgents API call to: ${freeAgentsUrl}`);
        
        const response = await axios.get(freeAgentsUrl, {
            headers,
            params: {
                view: 'kona_player_info',  // This should return complete player info
                scoringPeriodId: 0  // 0 = preseason, should have all players available
            },
            timeout: 20000
        });
        
        console.log(`âœ… getFreeAgents response received`);
        console.log(`ðŸ“Š Response structure:`, Object.keys(response.data || {}));
        
        // The docs show that players should be in the response
        let playersData = [];
        
        if (response.data.players) {
            playersData = response.data.players;
            console.log(`ðŸ“¦ Found players in response.data.players: ${playersData.length}`);
        } else {
            console.log(`âš ï¸ No players found, checking full response structure...`);
            console.log(`ðŸ“Š Full response:`, JSON.stringify(response.data, null, 2).substring(0, 1000));
            
            // Fall back to your original working endpoint if getFreeAgents doesn't work
            console.log(`ðŸ”„ Falling back to original players endpoint...`);
            
            const fallbackUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/players`;
            const fallbackHeaders = {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'X-Fantasy-Filter': JSON.stringify({
                    players: {
                        limit: 2000,
                        sortPercOwned: {
                            sortPriority: 1,
                            sortAsc: false
                        }
                    }
                })
            };
            
            const fallbackResponse = await axios.get(fallbackUrl, {
                headers: fallbackHeaders,
                params: { view: 'players_wl' },
                timeout: 20000
            });
            
            if (fallbackResponse.data && Array.isArray(fallbackResponse.data)) {
                playersData = fallbackResponse.data;
                console.log(`âœ… Fallback successful: ${playersData.length} players`);
            } else {
                throw new Error('Both getFreeAgents and fallback failed');
            }
        }
        
        if (playersData.length === 0) {
            throw new Error('No players data retrieved');
        }
        
        console.log(`ðŸ” Processing ${playersData.length} players...`);
        
        // Sample player structure for debugging
        if (playersData[0]) {
            console.log(`ðŸ“Š Sample player structure:`, JSON.stringify(playersData[0], null, 2).substring(0, 500));
        }
        
        // Process players according to FreeAgentPlayerMap structure from docs
        const FANTASY_POSITIONS = [1, 2, 3, 4, 5, 16];
        
        const players = playersData.map(playerEntry => {
            // Handle both direct player objects and wrapped player objects
            const player = playerEntry.player || playerEntry;
            
            if (!player || !player.fullName) return null;
            
            // Extract data according to official PlayerMap structure
            let adp = 999;
            let projectedPoints = 0;
            let ownership = 0;
            
            // According to docs, averageDraftPosition should be directly on player
            if (player.averageDraftPosition) {
                adp = player.averageDraftPosition;
            } else if (player.ownership && player.ownership.averageDraftPosition) {
                adp = player.ownership.averageDraftPosition;
            }
            
            // According to docs, percentOwned should be directly on player  
            if (player.percentOwned) {
                ownership = player.percentOwned;
            } else if (player.ownership && player.ownership.percentOwned) {
                ownership = player.ownership.percentOwned;
            }
            
            // According to docs, projectedRawStats should contain projections
            if (playerEntry.projectedRawStats && playerEntry.projectedRawStats.appliedTotal) {
                projectedPoints = playerEntry.projectedRawStats.appliedTotal;
            } else if (player.projectedRawStats && player.projectedRawStats.appliedTotal) {
                projectedPoints = player.projectedRawStats.appliedTotal;
            } else if (player.stats && Array.isArray(player.stats)) {
                // Look for projected stats in stats array
                const projectedStat = player.stats.find(stat => 
                    stat.seasonId === seasonId && stat.statSourceId === 1
                );
                if (projectedStat && projectedStat.appliedTotal) {
                    projectedPoints = projectedStat.appliedTotal;
                }
            }
            
            return {
                id: player.id,
                name: player.fullName,
                team: player.proTeamAbbreviation || getTeamAbbr(player.proTeamId),
                position: player.defaultPosition || getPositionName(player.defaultPositionId),
                positionId: player.defaultPositionId,
                
                // REAL DATA from ESPN API according to docs
                projectedPoints: projectedPoints,
                ownership: ownership,
                adp: adp,
                percentStarted: player.percentStarted || (player.ownership && player.ownership.percentStarted) || 0,
                
                // Status according to docs
                eligiblePositions: player.eligiblePositions || (player.eligibleSlots && player.eligibleSlots.map(slot => getPositionName(slot)).filter(pos => pos !== 'Unknown')) || [getPositionName(player.defaultPositionId)],
                availabilityStatus: player.availabilityStatus || 'FREEAGENT',
                isDroppable: player.isDroppable !== false,
                isInjured: player.isInjured === true,
                injuryStatus: player.injuryStatus || 'ACTIVE',
                
                // Additional info
                jerseyNumber: player.jerseyNumber,
                
                // Tier classification based on ADP
                tier: adp <= 24 ? 'elite' : adp <= 60 ? 'starter' : adp <= 120 ? 'depth' : adp <= 180 ? 'popular' : 'sleeper',
                
                // Data quality indicators  
                hasRealADP: adp > 0 && adp < 500,
                hasRealProjections: projectedPoints > 0,
                
                // Debug info
                rawPlayer: player,
                rawPlayerEntry: playerEntry,
                dataSource: 'getFreeAgents'
            };
        }).filter(player => {
            if (!player || !player.name || player.name.length < 2) return false;
            if (!FANTASY_POSITIONS.includes(player.positionId)) return false;
            
            // Keep all fantasy-relevant players
            const hasSignificantOwnership = player.ownership > 1;
            const hasValidADP = player.adp > 0 && player.adp < 400;
            const hasProjections = player.projectedPoints > 0;
            const isFantasyRelevant = player.ownership > 0 || player.adp < 500;
            
            return hasSignificantOwnership || hasValidADP || hasProjections || isFantasyRelevant;
        }).sort((a, b) => {
            // Sort by ADP first if available
            if (a.hasRealADP && b.hasRealADP) {
                return a.adp - b.adp;
            }
            if (a.hasRealADP && !b.hasRealADP) return -1;
            if (!a.hasRealADP && b.hasRealADP) return 1;
            
            // Then by ownership
            if (a.ownership !== b.ownership) {
                return b.ownership - a.ownership;
            }
            
            // Finally by projections
            return b.projectedPoints - a.projectedPoints;
        });
        
        console.log(`ðŸ“Š Processed ${players.length} fantasy players`);
        
        // Show data quality stats
        const dataQuality = {
            totalPlayers: players.length,
            playersWithRealADP: players.filter(p => p.hasRealADP).length,
            playersWithRealProjections: players.filter(p => p.hasRealProjections).length,
            averageADP: players.filter(p => p.hasRealADP).reduce((sum, p) => sum + p.adp, 0) / players.filter(p => p.hasRealADP).length || 0,
            averageProjections: players.filter(p => p.hasRealProjections).reduce((sum, p) => sum + p.projectedPoints, 0) / players.filter(p => p.hasRealProjections).length || 0
        };
        
        console.log(`ðŸ“ˆ Data quality:`, dataQuality);
        
        // Show top 10 for debugging
        console.log('ðŸ† Top 10 players:');
        players.slice(0, 10).forEach((player, i) => {
            console.log(`${i+1}. ${player.name} - ADP: ${player.adp} (${player.hasRealADP ? 'REAL' : 'fallback'}), Proj: ${player.projectedPoints} (${player.hasRealProjections ? 'REAL' : 'fallback'}), Own: ${player.ownership}%`);
        });
        
        res.json(players);
        
    } catch (error) {
        console.error('âŒ Error fetching players:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch players from ESPN API',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ADD A SIMPLE TEST ENDPOINT TO CHECK DATA STRUCTURE
app.get('/api/test-free-agents/:seasonId', async (req, res) => {
    try {
        const seasonId = parseInt(req.params.seasonId);
        
        if (!leagueConfig || !leagueConfig.leagueId) {
            return res.status(400).json({ error: 'Must connect to league first' });
        }
        
        const freeAgentsUrl = `${ESPN_BASE_URL}/seasons/${seasonId}/segments/0/leagues/${leagueConfig.leagueId}`;
        
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        
        if (leagueConfig.espnS2 && leagueConfig.swid) {
            headers['Cookie'] = `espn_s2=${leagueConfig.espnS2}; SWID=${leagueConfig.swid}`;
        }
        
        const response = await axios.get(freeAgentsUrl, {
            headers,
            params: {
                view: 'kona_player_info',
                scoringPeriodId: 0
            },
            timeout: 15000
        });
        
        res.json({
            success: true,
            responseKeys: Object.keys(response.data || {}),
            sampleData: response.data,
            playerCount: response.data.players ? response.data.players.length : 0,
            samplePlayer: response.data.players ? response.data.players[0] : null
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            details: 'Test free agents endpoint failed'
        });
    }
});

async function testEnhancedESPN() {
    try {
        showStatus('Testing enhanced ESPN API...', 'loading');
        
        const response = await fetch(`/api/players-enhanced-espn/${currentSeasonId || 2025}`);
        const results = await response.json();
        
        console.log('ðŸ§ª Enhanced ESPN Results:', results);
        
        if (results.dataQuality) {
            let message = `Enhanced ESPN Test Results:\n\n`;
            message += `Total Players: ${results.dataQuality.totalPlayers}\n`;
            message += `Players with Real ADP: ${results.dataQuality.playersWithRealADP}\n`;
            message += `Players with Real Projections: ${results.dataQuality.playersWithRealProjections}\n\n`;
            message += `Top 5 Players:\n`;
            results.dataQuality.topPlayersWithADP.slice(0, 5).forEach((player, i) => {
                message += `${i+1}. ${player.name} - ADP: ${player.adp}, Proj: ${player.projections}\n`;
            });
            
            showStatus('âœ… Enhanced ESPN test complete', 'success');
            alert(message);
        } else {
            showStatus('âŒ Enhanced ESPN test failed', 'error');
        }
        
    } catch (error) {
        console.error('Enhanced test failed:', error);
        showStatus('âŒ Enhanced ESPN test failed', 'error');
    }
}


// Utility functions
function getTeamAbbr(teamId) {
    const teams = {
        1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
        9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
        17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
        25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
    };
    return teams[teamId] || 'FA';
}

function getPositionName(positionId) {
    // Updated position mapping based on 2025 ESPN API
    const positions = {
        1: 'QB',    // Quarterback  
        2: 'RB',    // Running Back
        3: 'WR',    // Wide Receiver
        4: 'TE',    // Tight End
        5: 'K',     // Kicker
        16: 'D/ST', // Defense/Special Teams
        // Legacy mappings (if ESPN still uses these)
        0: 'QB', 6: 'TE', 17: 'K'
    };
    return positions[positionId] || 'Unknown';
}

// Serve the web app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        connected: !!leagueConfig,
        league: leagueConfig?.leagueId || 'Not connected',
        apiUrl: ESPN_BASE_URL
    });
});

app.listen(port, () => {
    console.log(`ðŸˆ Fantasy Draft Assistant 2025 is running!`);
    console.log(`ðŸˆ Server: http://localhost:${port}`);
    console.log(`ðŸ“± Mobile: http://[YOUR_IP]:${port}`);
    console.log(`ðŸŽ¯ Ready for your draft!`);
    console.log(`ðŸ”— Using ESPN API: ${ESPN_BASE_URL}`);
    console.log('');
    console.log('ðŸ§ª Debug endpoint available: /api/debug/[seasonId]');
    console.log('ðŸ” Test endpoint available: /api/test/[leagueId]/[seasonId]');
});