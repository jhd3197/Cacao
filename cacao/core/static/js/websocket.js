/*
WebSocket client for Cacao framework.
Handles real-time updates and UI synchronization.
*/

(function() {
    // WebSocket connection management
    let WS_URL = null;
    let socket = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let reconnectTimeout = null;
    let refreshInProgress = false;
    let stateUpdateInProgress = false;

    // State management
    let currentState = {};

    function getWebSocketUrl() {
        // Get the port from the URL query parameter or meta tag if available
        const urlParams = new URLSearchParams(window.location.search);
        const metaPort = document.querySelector('meta[name="ws-port"]')?.content;
        const wsPort = urlParams.get('ws_port') || metaPort || '1633';
        return `ws://${window.location.hostname}:${wsPort}`;
    }

    function connect(customUrl) {
        // Clear any existing reconnect attempts
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
        }

        // Close existing socket if it exists
        if (socket) {
            try {
                socket.close();
            } catch (e) {
                console.log('[CacaoWS] Error closing existing socket:', e);
            }
        }

        WS_URL = customUrl || getWebSocketUrl();
        console.log('[CacaoWS] Connecting to WebSocket server at', WS_URL);

        try {
            socket = new WebSocket(WS_URL);

            socket.onopen = function() {
                console.log('[CacaoWS] Connected to WebSocket server');
                reconnectAttempts = 0;

                // Sync initial state from URL hash
                const hash = window.location.hash.slice(1);
                if (hash && hash !== currentState.current_page) {
                    syncState({ current_page: hash });
                }
            };

            socket.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    
                    // Handle UI update events
                    if (data.type === 'ui_update') {
                        console.log('[CacaoWS] Received UI update', data);
                        
                        // Update current state with server state
                        if (data.state) {
                            currentState = data.state;
                            
                            // Update URL hash if current_page changed and different from current hash
                            const newPage = data.state.current_page;
                            const currentHash = window.location.hash.slice(1);
                            if (newPage && newPage !== currentHash) {
                                // Use history.replaceState to avoid triggering another hashchange event
                                window.history.replaceState(null, '', `#${newPage}`);
                            }
                        }
                        
                        // Prevent multiple simultaneous refreshes
                        if (refreshInProgress) {
                            console.log('[CacaoWS] Refresh already in progress, skipping');
                            return;
                        }
                        
                        refreshInProgress = true;
                        
                        // Show refresh overlay
                        const overlay = document.querySelector('.refresh-overlay');
                        if (overlay) overlay.classList.add('active');
                        
                        // Force UI refresh with hash state
                        const hash = window.location.hash.slice(1);
                        fetch(`/api/ui?force=true&_hash=${hash}&t=${Date.now()}`, {
                            headers: {
                                'Cache-Control': 'no-cache, no-store, must-revalidate',
                                'Pragma': 'no-cache',
                                'Expires': '0'
                            }
                        })
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Server returned ${response.status}`);
                            }
                            return response.json();
                        })
                        .then(uiData => {
                            console.log('[CacaoWS] Fetched new UI data', uiData);
                            if (window.CacaoCore && typeof window.CacaoCore.render === "function") {
                                window.CacaoCore.render(uiData);
                            } else {
                                console.error('[CacaoWS] CacaoCore.render not available');
                                // Hide refresh overlay if CacaoCore.render is not available
                                const overlay = document.querySelector('.refresh-overlay');
                                if (overlay) overlay.classList.remove('active');
                            }
                        })
                        .catch(error => {
                            console.error('[CacaoWS] Error fetching UI update:', error);
                            // Hide overlay on error
                            const overlay = document.querySelector('.refresh-overlay');
                            if (overlay) overlay.classList.remove('active');
                        })
                        .finally(() => {
                            refreshInProgress = false;
                        });
                    }
                } catch (error) {
                    console.error('[CacaoWS] Error processing message:', error);
                    // Hide overlay on error
                    const overlay = document.querySelector('.refresh-overlay');
                    if (overlay) overlay.classList.remove('active');
                }
            };

            socket.onclose = function(event) {
                console.log('[CacaoWS] WebSocket connection closed', event);
                
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    const timeout = Math.pow(2, reconnectAttempts) * 1000;
                    console.log(`[CacaoWS] Attempting to reconnect in ${timeout/1000} seconds`);
                    
                    reconnectTimeout = setTimeout(() => connect(WS_URL), timeout);
                } else {
                    console.error('[CacaoWS] Max reconnect attempts reached');
                }
            };

            socket.onerror = function(error) {
                console.error('[CacaoWS] WebSocket error:', error);
            };
        } catch (e) {
            console.error('[CacaoWS] Error creating WebSocket:', e);
        }
    }

    // Function to sync state with server
    async function syncState(newState) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.error('[CacaoWS] Cannot sync state - WebSocket not connected');
            return;
        }

        // Prevent duplicate state updates
        if (stateUpdateInProgress) {
            console.log('[CacaoWS] State update already in progress, skipping');
            return;
        }

        stateUpdateInProgress = true;

        try {
            socket.send(JSON.stringify({
                action: 'sync_state',
                state: newState
            }));
            console.log('[CacaoWS] State sync sent:', newState);
        } catch (error) {
            console.error('[CacaoWS] Error syncing state:', error);
        } finally {
            stateUpdateInProgress = false;
        }
    }

    // Function to handle URL hash changes
    async function handleHashChange() {
        const hash = window.location.hash.slice(1);
        if (hash && hash !== currentState.current_page) {
            await syncState({ current_page: hash });
        }
    }

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);

    // Expose WebSocket functionality
    window.CacaoWS = {
        connect: connect,
        syncState: syncState,
        forceRefresh: function() {
            console.log('[CacaoWS] Forcing UI refresh');
            
            // Show refresh overlay
            const overlay = document.querySelector('.refresh-overlay');
            if (overlay) overlay.classList.add('active');
            
            fetch('/api/ui?force=true&t=' + Date.now(), {
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}`);
                }
                return response.json();
            })
            .then(uiData => {
                console.log('[CacaoWS] Fetched new UI data', uiData);
                if (window.CacaoCore && typeof window.CacaoCore.render === "function") {
                    window.CacaoCore.render(uiData);
                } else {
                    console.error('[CacaoWS] CacaoCore.render not available');
                }
            })
            .catch(error => {
                console.error('[CacaoWS] Error forcing refresh:', error);
                // Hide overlay on error
                if (overlay) overlay.classList.remove('active');
            });
        },
        requestServerRefresh: function() {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({action: 'refresh'}));
                console.log('[CacaoWS] Requested server refresh');
            } else {
                console.error('[CacaoWS] WebSocket not connected, cannot request refresh');
                // Fallback to direct refresh
                this.forceRefresh();
            }
        },
        getStatus: function() {
            return socket ? socket.readyState : -1;
        }
    };
})();
