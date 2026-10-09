// Simple layout wrapper for EJS views
// Reads the view file, renders it, then wraps in layout

const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

const VIEWS = path.join(__dirname, '../../views');

/**
 * Extend Express's res.render to support layout
 */
function applyLayout(app) {
  const originalRender = app.response.render;

  app.response.render = function (view, options, fn) {
    const self = this;
    const req  = this.req;

    // Determine layout
    const opts = typeof options === 'object' ? options : {};

    // First render the view
    originalRender.call(self, view, opts, function (err, html) {
      if (err) {
        if (fn) return fn(err);
        return self.req.next(err);
      }

      // Choose layout based on view path prefix
      // admin/login is a full standalone page — skip layout
      if (view === 'admin/login' || view === 'admin\\login') {
        if (fn) return fn(null, html);
        return self.send(html);
      }

      let layoutName = 'public';
      if (view.startsWith('admin/') || view.startsWith('admin\\')) {
        layoutName = 'admin';
      } else if (view.startsWith('dashboard/') || view.startsWith('dashboard\\')) {
        layoutName = 'dashboard';
      } else if (view.startsWith('auth/') || view.startsWith('auth\\')) {
        layoutName = 'auth-bare';
      }

      const layoutOpts = Object.assign({}, opts, { body: html });

      originalRender.call(self, `layouts/${layoutName}`, layoutOpts, function (err2, fullHtml) {
        if (err2) {
          // No layout found, just send the view
          if (fn) return fn(null, html);
          return self.send(html);
        }
        if (fn) return fn(null, fullHtml);
        self.send(fullHtml);
      });
    });
  };
}

module.exports = { applyLayout };
