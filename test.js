const fs = require('fs');
const path = require('path');

const htmlSource = fs.readFileSync('index.html', 'utf8');

// Pull local <script src="js/...">  tags out of index.html, in document order,
// and concatenate them into one script — this mirrors what the browser
// actually does when index.html loads several plain (non-module) scripts
// into a single shared global scope. Loading js/app.js alone (as this file
// used to) meant functions/globals defined in other scripts (js/supabase.js,
// and later the split-out js/db.js, js/auth.js, js/greenbean.js, etc.) were
// missing, so this generalizes automatically as app.js gets split further —
// no need to edit this file again for each new split.
const scriptTagRe = /<script\s+src="(js\/[^"?]+)(?:\?[^"]*)?"[^>]*><\/script>/g;
const files = [];
let m;
while ((m = scriptTagRe.exec(htmlSource))) {
    files.push(m[1]);
}

console.log("Loading scripts in order:", files.join(', '));

let combined = '';
for (const f of files) {
    combined += fs.readFileSync(f, 'utf8') + '\n;\n';
}

console.log("Combined size:", combined.length);

try {
    const vm = require('vm');
    // Load the REAL index.html body (not an empty <body></body>) so that
    // top-level code which does document.getElementById('x').addEventListener(...)
    // without a null check finds the actual element instead of crashing on
    // `null` — previously this made evaluation stop at whichever element it
    // hit first, silently skipping checks on everything after that point.
    const dom = new (require('jsdom').JSDOM)(htmlSource, { url: 'http://localhost/' });

    // Minimal Supabase stub: js/supabase.js sets window.supabaseClient = null
    // until createClient() runs against the real CDN script (not present in
    // this sandbox), so bootstrap()'s calls into it are stubbed out here —
    // this is a test-harness limitation, not something to "fix" in app code.
    const fakeQueryBuilder = {
        select: () => fakeQueryBuilder,
        eq: () => fakeQueryBuilder,
        single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve) => resolve({ data: [], error: null }),
    };
    dom.window.supabaseClient = {
        from: () => fakeQueryBuilder,
        auth: {
            getSession: () => Promise.resolve({ data: { session: null } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
    };
    dom.window.isConnected = () => true;

    const context = {
        window: dom.window,
        document: dom.window.document,
        localStorage: {
            store: {},
            getItem: function(k) { return this.store[k] || null; },
            setItem: function(k, v) { this.store[k] = v; }
        },
        alert: console.log,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        fetch: () => Promise.resolve({ json: () => Promise.resolve([]) })
    };

    vm.createContext(context);
    vm.runInContext(combined, context);
    console.log("Script evaluated successfully without SyntaxErrors.");
} catch(e) {
    console.log("Error evaluating script:", e);
    process.exitCode = 1;
}
