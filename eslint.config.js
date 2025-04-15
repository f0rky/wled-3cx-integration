const globals = require("globals");
const pluginJs = require("@eslint/js");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
  {
    languageOptions: { 
      globals: {
        ...globals.browser,
        ...globals.node,
        process: "readonly" // Make process explicitly available
      },
      ecmaVersion: 2021, // Or latest supported
      sourceType: "commonjs" // Assuming CommonJS modules based on require()
    }
  },
  pluginJs.configs.recommended,
  // Include prettier config rules last to override others
  prettierConfig, 
  {
    // Custom rules can be added here if needed
    rules: {
      // Example: enforce curly braces for all control statements
      // "curly": ["error", "all"],
      // Allow unused variables starting with an underscore, especially in catch clauses
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }]
    }
  },
  {
    // Define files/directories to ignore
    ignores: [
      "node_modules/", 
      "dist/", 
      "public/",
      "*.json", // Ignoring all json files, including cookies.json
      "*.md",
      "*.log",
      "src/threecx-web-client.js" // Ignore the older/unused version
    ]
  }
];
