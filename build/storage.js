(function() {
  'use strict';
  var settings;

  settings = require('./settings');

  module.exports = function() {
    var local, s3;
    s3 = require('./s3')();
    local = require('./local')();
    return {
      keys: function(from, prefix, cb) {
        if (!settings.PREFER_LOCAL) {
          if (settings.LOCAL_STORAGE) {
            return local.keys(from, prefix, function(e, r) {
              if (e && settings.AWS_OK) {
                return s3.keys(from, prefix, cb);
              } else {
                return cb(e, r);
              }
            });
          } else if (settings.AWS_OK) {
            return s3.keys(from, prefix, cb);
          } else {
            return cb('no storage', null);
          }
        } else {
          if (settings.AWS_OK) {
            return s3.keys(from, prefix, function(e, r) {
              if (e && settings.LOCAL_STORAGE) {
                return local.keys(from, prefix, cb);
              } else {
                return cb(e, r);
              }
            });
          } else if (settings.LOCAL_STORAGE) {
            return local.keys(from, prefix, cb);
          } else {
            return cb('no storage', null);
          }
        }
      },
      del: function(key, cb) {
        if (settings.LOCAL_STORAGE) {
          return local.del(key, function(e, r) {
            if (settings.AWS_OK) {
              return s3.del(key, cb);
            }
          });
        } else if (settings.AWS_OK) {
          return s3.del(key, cb);
        }
      },
      put: function(key, o, cb) {
        if (settings.LOCAL_STORAGE) {
          return local.put(key, o, function(e, r) {
            if (settings.AWS_OK) {
              return s3.put(key, o, cb);
            } else {
              return typeof cb === "function" ? cb(e, r) : void 0;
            }
          });
        } else if (settings.AWS_OK) {
          return s3.put(key, o, cb);
        }
      },
      get: function(key, cb) {
        if (!settings.PREFER_LOCAL) {
          if (settings.LOCAL_STORAGE) {
            return local.get(key, function(e, r) {
              if (e && settings.AWS_OK) {
                return s3.get(key, cb);
              } else {
                return cb(e, r);
              }
            });
          } else if (settings.AWS_OK) {
            return s3.get(key, cb);
          } else {
            return cb('no storage', null);
          }
        } else {
          if (settings.AWS_OK) {
            return s3.get(key, function(e, r) {
              if (e && settings.LOCAL_STORAGE) {
                return local.get(key, cb);
              } else {
                return cb(e, r);
              }
            });
          } else if (settings.LOCAL_STORAGE) {
            return local.get(key, cb);
          } else {
            return cb('no storage', null);
          }
        }
      }
    };
  };

}).call(this);

//# sourceMappingURL=storage.js.map
