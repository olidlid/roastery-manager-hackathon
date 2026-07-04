const fs = require('fs');

const file = fs.readFileSync('js/app.js', 'utf8');

// Simple validation
console.log("File size:", file.length);

let errors = [];

try {
    const vm = require('vm');
    const dom = new (require('jsdom').JSDOM)(`<!DOCTYPE html><html><body></body></html>`);
    
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
    vm.runInContext(file, context);
    console.log("Script evaluated successfully without SyntaxErrors.");
} catch(e) {
    console.log("Error evaluating script:", e);
}
