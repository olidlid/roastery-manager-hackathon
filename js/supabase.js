// SUPABASE CLIENT INITIALIZATION - ROASTERY MANAGER V2 (GLOBAL SCRIPT VERSION)
// This script runs globally and defines window.supabaseClient and connection helpers.
// Credentials are hardcoded so the app is always full-Supabase, consistent across every browser/device.

(function() {
    const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
    const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

    window.SUPABASE_URL = SUPABASE_URL;
    window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
    window.supabaseClient = null;

    /**
     * Check if the Supabase client has been initialized.
     */
    window.isConnected = function() {
        return window.supabaseClient !== null;
    };

    function createClient() {
        if (typeof supabase === 'undefined') {
            console.error("Supabase library not loaded yet.");
            return false;
        }
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                detectSessionInUrl: true,
                autoRefreshToken: true,
                persistSession: true,
                flowType: 'implicit'
            }
        });
        console.log("Supabase Client initialized successfully.");
        return true;
    }

    if (!createClient()) {
        // Library not ready yet, try again after a short delay
        setTimeout(createClient, 100);
    }
})();
