   // config-overrides.js
   const webpack = require('webpack');

   module.exports = function override(config, env) {
    // Add .mjs to the list of resolved extensions
    config.resolve.extensions.push('.mjs');

    // Add fallback for 'fs' and 'path'
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };

    // Add node-specific modules
    config.resolve.alias = {
      ...config.resolve.alias,
      'pdfjs-dist': 'pdfjs-dist/webpack',
    };

    return config;
  };