// SUPABASE CLIENT INITIALIZATION - ROASTERY MANAGER V2 (GLOBAL SCRIPT VERSION)
// This script runs globally and defines window.supabaseClient and connection helpers.

(function() {
    // Retrieve credentials from localStorage
    let supabaseUrl = localStorage.getItem('supabase_url') || '';
    let supabaseKey = localStorage.getItem('supabase_key') || '';

    window.supabaseClient = null;

    /**
     * Check if the database connection details are configured.
     */
    window.isConnected = function() {
        return supabaseUrl !== '' && supabaseKey !== '' && window.supabaseClient !== null;
    };

    /**
     * Initialize Supabase client and save keys to localStorage.
     */
    window.initSupabase = function(url, key) {
        if (!url || !key) return false;
        try {
            const cleanUrl = url.trim();
            const cleanKey = key.trim();
            
            // supabase global object comes from the CDN script tag in index.html
            if (typeof supabase === 'undefined') {
                console.error("Supabase library not loaded yet.");
                return false;
            }
            
            window.supabaseClient = supabase.createClient(cleanUrl, cleanKey);
            supabaseUrl = cleanUrl;
            supabaseKey = cleanKey;
            
            localStorage.setItem('supabase_url', cleanUrl);
            localStorage.setItem('supabase_key', cleanKey);
            
            console.log("Supabase Client initialized successfully.");
            return true;
        } catch (e) {
            console.error("Failed to initialize Supabase:", e);
            return false;
        }
    };

    /**
     * Clear connection settings.
     */
    window.disconnectSupabase = function() {
        window.supabaseClient = null;
        supabaseUrl = '';
        supabaseKey = '';
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_key');
        console.log("Supabase connection reset.");
    };

    // Auto-initialize if credentials exist (synchronous — must run before app.js reads isMockMode)
    if (supabaseUrl && supabaseKey) {
        try {
            if (typeof supabase !== 'undefined') {
                window.supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
                console.log("Supabase Client initialized successfully.");
            } else {
                // Fallback: library not ready yet, try after a short delay
                setTimeout(() => {
                    window.initSupabase(supabaseUrl, supabaseKey);
                }, 100);
            }
        } catch(e) {
            console.error("Auto-init failed:", e);
        }
    }
})();
