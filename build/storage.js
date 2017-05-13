(function() {
  'use strict';
  var async, crypto, es, jsonStream, settings, zlib;

  settings = require('./settings');

  async = require('async');

  crypto = require('crypto');

  jsonStream = require('JSONStream');

  es = require('event-stream');

  zlib = require('zlib');

  module.exports = function() {
    var algorithm, devices, doencrypt, dozip, local, s3;
    algorithm = settings.ENCRYPTION_ALGORITHM || 'aes-256-ctr';
    doencrypt = !settings.DO_NOT_ENCRYPT;
    dozip = !settings.DO_NOT_ENCRYPT;
    s3 = require('./s3')();
    local = require('./local')();
    devices = [];
    if (settings.LOCAL_STORAGE) {
      devices.push(local);
    }
    if (settings.AWS_OK) {
      devices.push(s3);
    }
    return {
      checkDataDir: function() {
        if (settings.LOCAL_STORAGE) {
          return local.checkDataDir();
        }
      },
      keys: function(from, prefix, cb) {
        var calledBack;
        if (!devices.length) {
          return typeof cb === "function" ? cb('no storage', null) : void 0;
        } else {
          calledBack = false;
          return async.each(devices, function(device, callback) {
            return device.keys(from, prefix, function(e, r) {
              if (!e || calledBack) {
                calledBack = true;
                if (typeof cb === "function") {
                  cb(e, r);
                }
              }
              return callback();
            });
          }, function() {
            if (!calledBack) {
              return typeof cb === "function" ? cb('nothing found', null) : void 0;
            }
          });
        }
      },
      del: function(key, cb) {
        return async.each(devices, function(device, callback) {
          return device.del(key, function() {
            return callback();
          });
        }, function() {
          return typeof cb === "function" ? cb() : void 0;
        });
      },
      put: function(key, o, cb, notCritical, writeStream) {
        var device, encrypt, gzip, i, jsStringify, len, st, ws;
        if (!devices.length || notCritical) {
          return typeof cb === "function" ? cb(null, null) : void 0;
        } else {
          if (key.indexOf(':node:') !== -1) {
            key = "" + key;
          }
          jsStringify = new jsonStream.stringify();
          encrypt = crypto.createCipher(algorithm, settings.ENCRYPTION_KEY || settings.SESSION_SECRET || '5random7493nonsens!e');
          gzip = zlib.createGzip();
          st = null;
          ws = null;
          if (dozip) {
            st = jsStringify.pipe(gzip);
          }
          if (doencrypt) {
            if (st) {
              st = st.pipe(encrypt);
            } else {
              st = jsStringify.pipe(encrypt);
            }
          }
          if (!st) {
            st = jsStringify;
          }
          if (writeStream) {
            st = st.pipe(writeStream);
          } else {
            for (i = 0, len = devices.length; i < len; i++) {
              device = devices[i];
              writeStream = device.getWriteStream(key);
              st = st.pipe(writeStream);
            }
          }
          jsStringify.write(o, function() {
            return jsStringify.flush();
          });
          jsStringify.end();
          st.on('close', function() {
            return typeof cb === "function" ? cb(null, null) : void 0;
          });
          st.on('error', function(er) {});
          writeStream.on('error', function(er) {});
          writeStream.on('uploaded', function(res) {
            return typeof cb === "function" ? cb(null, null) : void 0;
          });
          gzip.on('error', function(er) {});
          return encrypt.on('error', function(er) {});
        }
      },
      get: function(key, cb, reader) {
        var decrypt, finished, gunzip, jsParse;
        if (!devices) {
          if (typeof cb === "function") {
            cb('no devices', null);
          }
          return typeof done === "function" ? done() : void 0;
        } else {
          jsParse = new jsonStream.parse('*');
          decrypt = crypto.createDecipher(algorithm, settings.ENCRYPTION_KEY || settings.SESSION_SECRET || '5random7493nonsens!e');
          gunzip = zlib.createGunzip();
          finished = false;
          return async.eachSeries(devices, function(device, callback) {
            var calledBack, st;
            if (!finished) {
              calledBack = false;
              if (!reader) {
                reader = device.getReadStream(key);
              }
              st = reader;
              if (doencrypt) {
                st = st.pipe(decrypt);
              }
              if (dozip) {
                st = st.pipe(gunzip);
              }
              st.pipe(jsParse).pipe(es.mapSync(function(data) {
                finished = true;
                calledBack = true;
                if (typeof cb === "function") {
                  cb(null, data);
                }
                if (typeof done === "function") {
                  done();
                }
                return callback();
              }));
              reader.on('error', function(e) {
                if (!calledBack) {
                  calledBack = true;
                  return callback();
                }
              });
              st.on('error', function(e) {
                if (!calledBack) {
                  calledBack = true;
                  finished = true;
                  if (typeof cb === "function") {
                    cb('encrypt error', null);
                  }
                  return callback();
                }
              });
              jsParse.on('error', function(e) {
                return console.log('Error parsing database - have you changed your encryption key or turned encryption on or off?  If so, update your database using ndx-framework.');
              });
              return st.on('end', function() {
                if (!calledBack) {
                  calledBack = true;
                  return callback();
                }
              });
            } else {
              return callback();
            }
          }, function() {
            if (!finished) {
              if (typeof cb === "function") {
                cb('nothing found', null);
              }
              return typeof done === "function" ? done() : void 0;
            }
          });
        }
      },
      putOld: function(key, o, cb, notCritical) {
        if (settings.LOCAL_STORAGE) {
          if (!notCritical) {
            return local.put(key, o, function(e, r) {
              if (settings.AWS_OK) {
                return s3.put(key, o, cb);
              } else {
                return typeof cb === "function" ? cb(e, r) : void 0;
              }
            });
          }
        } else if (settings.AWS_OK && (!notCritical)) {
          return s3.put(key, o, cb);
        } else {
          return typeof cb === "function" ? cb(null, null) : void 0;
        }
      },
      getOld: function(key, cb) {
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
