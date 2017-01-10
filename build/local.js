(function() {
  'use strict';
  var fs, glob, path, settings;

  settings = require('./settings');

  glob = require('glob');

  fs = require('fs');

  path = require('path');

  module.exports = function() {
    var checkDataDir, clean, unclean;
    clean = function(key) {
      key = key.replace(/:/g, '%%');
      return key.replace(/\//g, '££');
    };
    unclean = function(key) {
      var regex;
      key = key.replace(/%%/g, ':');
      key = key.replace(/££/g, '/');
      regex = new RegExp('^' + path.join(settings.LOCAL_STORAGE) + '\\\/');
      return key.replace(regex, '');
    };
    checkDataDir = function() {
      var exists;
      exists = fs.existsSync(path.join(settings.LOCAL_STORAGE));
      if (!exists) {
        return fs.mkdirSync(path.join(settings.LOCAL_STORAGE));
      }
    };
    checkDataDir();
    return {
      keys: function(from, prefix, cb) {
        return glob(path.join(settings.LOCAL_STORAGE, clean(prefix) + '*.json'), function(e, r) {
          var count, gotFrom, i, output;
          if (e) {
            return cb(e, null);
          }
          i = -1;
          count = 0;
          gotFrom = !from;
          output = {
            Contents: [],
            IsTruncated: false
          };
          while (++i < r.length && count < 1000) {
            if (gotFrom) {
              output.Contents.push({
                Key: unclean(r[i].replace('.json', ''))
              });
              count++;
            } else {
              if (r[i] === from + '.json') {
                gotFrom = true;
              }
            }
          }
          if (i < r.length) {
            output.IsTruncated = true;
          }
          return typeof cb === "function" ? cb(null, output) : void 0;
        });
      },
      del: function(key, cb) {
        fs.unlinkSync(path.join(settings.LOCAL_STORAGE, clean(key) + '.json'));
        return typeof cb === "function" ? cb(null, null) : void 0;
      },
      put: function(key, o, cb) {
        var uri;
        uri = path.join(settings.LOCAL_STORAGE, clean(key) + '.json');
        return fs.writeFile(uri, JSON.stringify(o), function(e) {
          return typeof cb === "function" ? cb(e, null) : void 0;
        });
      },
      get: function(key, cb) {
        return fs.readFile(path.join(settings.LOCAL_STORAGE, clean(key) + '.json'), 'utf8', function(e, r) {
          var d, error;
          d = null;
          try {
            d = JSON.parse(r);
          } catch (error) {
            e = error;
            return typeof cb === "function" ? cb(e || 'error', null) : void 0;
          }
          return typeof cb === "function" ? cb(e, d) : void 0;
        });
      }
    };
  };

}).call(this);

//# sourceMappingURL=local.js.map
