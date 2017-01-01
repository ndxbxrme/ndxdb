(function() {
  'use strict';
  var ObjectID, alasql, async;

  alasql = require('alasql');

  async = require('async');

  ObjectID = require('bson-objectid');

  module.exports = function(config) {
    var attachDatabase, database, dbname, maintenanceMode, s3;
    dbname = config.database || config.dbname || config.databaseName;
    s3 = require('./s3')(config);
    database = null;
    maintenanceMode = false;
    attachDatabase = function() {
      var deleteKeys, i, inflate, len, ref, table;
      maintenanceMode = true;
      alasql('CREATE DATABASE ' + dbname);
      alasql('USE ' + dbname);
      ref = config.tables;
      for (i = 0, len = ref.length; i < len; i++) {
        table = ref[i];
        alasql('CREATE TABLE ' + table);
      }
      database = alasql.databases[dbname];
      deleteKeys = function(cb) {
        return s3.keys(null, dbname + ':node:', function(e, r) {
          var j, key, len1, ref1;
          if (!e && r && r.Contents) {
            ref1 = r.Contents;
            for (j = 0, len1 = ref1.length; j < len1; j++) {
              key = ref1[j];
              s3.del(key.Key);
            }
          }
          if (r.IsTruncated) {
            return deleteKeys(cb);
          } else {
            return cb();
          }
        });
      };
      inflate = function(from, cb) {
        return s3.keys(from, dbname + ':node:', function(e, r) {
          if (e || !r.Contents) {
            return console.log('error', e);
          }
          return async.eachSeries(r.Contents, function(key, callback) {
            return key.Key.replace(/(.+):(.+):(.+)\/(.+)/, function(all, db, type, table, id) {
              if (db && table && id && db === dbname) {
                if (table.length === 1) {
                  return s3.get(key.Key, function(e, o) {
                    var idField;
                    if (e) {
                      return callback();
                    }
                    idField = config.autoId ? config.autoId : o._id ? '_id' : o.id ? 'id' : 'i';
                    if (o[idField]) {
                      database.exec('DELETE FROM ' + table + ' WHERE ' + idField + '=?', [o[idField]]);
                      if (!o['__!deleteMe!']) {
                        database.exec('INSERT INTO ' + table + ' VALUES ?', [o]);
                      }
                    }
                    return callback();
                  });
                } else {
                  return callback();
                }
              } else {
                return callback();
              }
            });
          }, function() {
            if (r.IsTruncated) {
              return inflate(r.Contents[r.Contents.length - 1].Key, cb);
            } else {
              return cb();
            }
          });
        });
      };
      if (config.awsBucket && config.awsId && config.awsKey) {
        s3.get(dbname + ':database', function(e, o) {
          var key;
          if (!e && o) {
            for (key in o) {
              if (database.tables[key]) {
                database.tables[key].data = o[key].data;
              }
            }
          }
          return inflate(null, function() {
            return deleteKeys(function() {
              return s3.put(dbname + ':database', database.tables, function(e) {
                if (!e) {
                  console.log('database updated and uploaded');
                  return maintenanceMode = false;
                }
              });
            });
          });
        });
        return setInterval(function() {
          maintenanceMode = true;
          return s3.put(dbname + ':database', database.tables, function(e) {
            if (!e) {
              console.log('database uploaded');
              return deleteKeys(function() {
                return maintenanceMode = false;
              });
            } else {
              return maintenanceMode = false;
            }
          });
        }, 11 * 60 * 60 * 1000);
      }
    };
    attachDatabase();
    return {
      exec: function(sql, props, notCritical) {
        var i, len, prop, ref;
        if (maintenanceMode) {
          return [];
        }
        if (config.autoId && sql.indexOf('INSERT') !== -1) {
          if (Object.prototype.toString.call(props[0]) === '[object Array]') {
            ref = props[0];
            for (i = 0, len = ref.length; i < len; i++) {
              prop = ref[i];
              prop[config.autoId] = ObjectID.generate();
            }
          } else {
            props[0][config.autoId] = ObjectID.generate();
          }
        }
        if (notCritical || !config.awsBucket || !config.awsId || !config.awsKey) {

        } else {
          if (sql.indexOf('UPDATE') !== -1) {
            sql.replace(/UPDATE (.+) SET (.+) WHERE (.+)/, function(all, table, set, where) {
              var noSetFields, res;
              noSetFields = (set.match(/\?/g) || []).length;
              props.splice(noSetFields);
              res = database.exec('SELECT * FROM ' + table + ' WHERE ' + where, props);
              if (res && res.length) {
                return async.each(res, function(r, callback) {
                  s3.put(dbname + ':node:' + table + '/' + (r[config.autoId] || r.i || r._id || r.id), r);
                  return callback();
                });
              }
            });
          } else if (sql.indexOf('DELETE') !== -1) {
            sql.replace(/DELETE FROM (.+) WHERE (.+)/, function(all, table, where) {
              var res;
              res = database.exec('SELECT * FROM ' + table + ' WHERE ' + where, props);
              if (res && res.length) {
                return async.each(res, function(r, callback) {
                  var delObj;
                  delObj = {
                    '__!deleteMe!': true
                  };
                  delObj[config.autoId || '_id'] = r[config.autoId] || r.id || r._id || r.i;
                  s3.put(dbname + ':node:' + table + '/' + (r[config.autoId] || r.id || r._id || r.i), delObj);
                  return callback();
                });
              }
            });
          } else if (sql.indexOf('INSERT') !== -1) {
            sql.replace(/INSERT INTO (.+) (SELECT|VALUES)/, function(all, table) {
              var j, len1, ref1, results;
              if (Object.prototype.toString.call(props[0]) === '[object Array]') {
                ref1 = props[0];
                results = [];
                for (j = 0, len1 = ref1.length; j < len1; j++) {
                  prop = ref1[j];
                  results.push(s3.put(dbname + ':node:' + table + '/' + (prop[config.autoId] || prop.i || prop._id || prop.id), prop));
                }
                return results;
              } else {
                return s3.put(dbname + ':node:' + table + '/' + (props[0][config.autoId] || props[0].i || props[0]._id || props[0].id), prop);
              }
            });
          }
        }
        return database.exec(sql, props);
      },
      maintenanceOn: function() {
        return maintenanceMode = true;
      },
      maintenanceOff: function() {
        return maintenanceMode = false;
      },
      maintenance: function() {
        return maintenanceMode;
      },
      getDb: function() {
        return database;
      },
      uploadDatabase: function(cb) {
        return s3.put(dbname + ':database', database.tables, function(e) {
          if (!e) {
            console.log('database uploaded');
          }
          return typeof cb === "function" ? cb() : void 0;
        });
      }
    };
  };

}).call(this);

//# sourceMappingURL=database.js.map
