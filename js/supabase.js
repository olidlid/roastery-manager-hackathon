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

        // Password recovery links land here with a #access_token=...&type=recovery
        // hash. detectSessionInUrl parses it immediately on client creation and
        // fires 'PASSWORD_RECOVERY' right away — long before app.js finishes its
        // bootstrap and calls checkAuthentication(). By the time app.js attaches
        // its own onAuthStateChange listener, that event has already fired and is
        // gone, so the recovery session would silently look like a normal login.
        // Catch it here, as early as possible, and let app.js poll the flag once
        // it's ready to show the "set new password" prompt.
        window.__pendingPasswordRecovery = false;
        window.supabaseClient.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                window.__pendingPasswordRecovery = true;
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
