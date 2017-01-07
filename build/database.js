(function() {
  'use strict';
  var ObjectID, alasql, async;

  alasql = require('alasql');

  async = require('async');

  ObjectID = require('bson-objectid');

  module.exports = function(config) {
    var attachDatabase, database, dbname, getId, getIdField, maintenanceMode, s3;
    dbname = config.database || config.dbname || config.databaseName;
    s3 = require('./s3')(config);
    database = null;
    maintenanceMode = false;
    getId = function(row) {
      return row[config.autoId] || row.id || row._id || row.i;
    };
    getIdField = function(row) {
      var output;
      output = '_id';
      if (row[config.autoId]) {
        output = config.autoId;
      } else if (row.id) {
        output = 'id';
      } else if (row._id) {
        output = '_id';
      } else if (row.i) {
        output = 'i';
      }
      return output;
    };
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
                return s3.get(key.Key, function(e, o) {
                  var idField;
                  if (e) {
                    return callback();
                  }
                  idField = getIdField(o);
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
      } else {
        return maintenanceMode = false;
      }
    };
    attachDatabase();
    return {
      exec: function(sql, props, notCritical) {
        var delReg, i, len, output, prop, ref, upReg, updateIds, updateTable;
        if (maintenanceMode) {
          return [];
        }
        if (config.autoId && /INSERT/i.test(sql)) {
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
        updateIds = [];
        updateTable = '';
        if (notCritical || !config.awsBucket || !config.awsId || !config.awsKey) {

        } else {
          if (/UPDATE/i.test(sql)) {
            upReg = /UPDATE\s+(.+)\s+SET\s+([^\s]+)/i;
            if (/WHERE/i.test(sql)) {
              upReg = /UPDATE\s+(.+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i;
            }
            sql.replace(upReg, function(all, table, set, where) {
              var noSetFields, pCopy;
              updateTable = table;
              noSetFields = (set.match(/\?/g) || []).length;
              pCopy = JSON.parse(JSON.stringify(props));
              pCopy.splice(0, noSetFields);
              if (where) {
                return updateIds = database.exec('SELECT * FROM ' + table + ' WHERE ' + where, pCopy);
              } else {
                return updateIds = database.exec('SELECT * FROM ' + table);
              }
            });
          } else if (/DELETE/i.test(sql)) {
            delReg = /DELETE\s+FROM\s+([^\s]+)/i;
            if (/WHERE/i.test(sql)) {
              delReg = /DELETE\s+FROM\s+(.+)\s+WHERE\s+(.+)/i;
            }
            sql.replace(delReg, function(all, table, where) {
              var res;
              if (where) {
                res = database.exec('SELECT * FROM ' + table + ' WHERE ' + where, props);
              } else {
                res = database.exec('SELECT * FROM ' + table);
              }
              if (res && res.length) {
                return async.each(res, function(r, callback) {
                  var delObj;
                  delObj = {
                    '__!deleteMe!': true
                  };
                  delObj[config.autoId || '_id'] = getId(r);
                  s3.put(dbname + ':node:' + table + '/' + getId(r), delObj);
                  if (config.callbacks && config.callbacks["delete"]) {
                    config.callbacks["delete"]({
                      id: getId(r),
                      table: table,
                      obj: delObj
                    });
                  }
                  return callback();
                });
              }
            });
          } else if (/INSERT/i.test(sql)) {
            sql.replace(/INSERT\s+INTO\s+(.+)\s+(SELECT|VALUES)/i, function(all, table) {
              var j, len1, ref1, results;
              if (Object.prototype.toString.call(props[0]) === '[object Array]') {
                ref1 = props[0];
                results = [];
                for (j = 0, len1 = ref1.length; j < len1; j++) {
                  prop = ref1[j];
                  s3.put(dbname + ':node:' + table + '/' + getId(prop), prop);
                  if (config.callbacks && config.callbacks.insert) {
                    results.push(config.callbacks.insert({
                      id: getId(prop),
                      table: table,
                      obj: prop
                    }));
                  } else {
                    results.push(void 0);
                  }
                }
                return results;
              } else {
                s3.put(dbname + ':node:' + table + '/' + getId(props[0]), props[0]);
                if (config.callbacks && config.callbacks.insert) {
                  return config.callbacks.insert({
                    id: getId(props[0]),
                    table: table,
                    obj: props[0]
                  });
                }
              }
            });
          }
        }
        output = database.exec(sql, props);
        if (updateIds && updateIds.length) {
          async.each(updateIds, function(updateId, callback) {
            var r, res;
            res = database.exec('SELECT * FROM ' + updateTable + ' WHERE ' + getIdField(updateId) + '=?', [getId(updateId)]);
            if (res && res.length) {
              r = res[0];
              s3.put(dbname + ':node:' + updateTable + '/' + getId(r), r);
              if (config.callbacks && config.callbacks.update) {
                config.callbacks.update({
                  id: getId(r),
                  table: updateTable,
                  obj: r
                });
              }
            }
            return callback();
          });
        }
        return output;
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
