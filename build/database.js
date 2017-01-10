(function() {
  'use strict';
  var ObjectID, alasql, async, settings;

  alasql = require('alasql');

  async = require('async');

  ObjectID = require('bson-objectid');

  settings = require('./settings');

  module.exports = function(config) {
    var attachDatabase, database, getId, getIdField, maintenanceMode, safeCallback, storage;
    settings.LOCAL_STORAGE = config.localStorage || config.local || settings.LOCAL_STORAGE;
    settings.PREFER_LOCAL = config.preferLocal || settings.PREFER_LOCAL;
    settings.DATABASE = config.database || config.dbname || config.databaseName || settings.DATABASE;
    settings.AUTO_ID = config.autoId || settings.AUTO_ID;
    settings.AWS_BUCKET = config.awsBucket || settings.AWS_BUCKET;
    settings.AWS_REGION = config.awsRegion || settings.AWS_REGION;
    settings.AWS_ID = config.awsId || settings.AWS_ID;
    settings.AWS_KEY = config.awsKey || settings.AWS_KEY;
    settings.AWS_OK = settings.AWS_BUCKET && settings.AWS_ID && settings.AWS_KEY;
    storage = require('./storage')();
    database = null;
    maintenanceMode = false;
    getId = function(row) {
      return row[settings.autoId] || row.id || row._id || row.i;
    };
    getIdField = function(row) {
      var output;
      output = '_id';
      if (row[settings.autoId]) {
        output = settings.autoId;
      } else if (row.id) {
        output = 'id';
      } else if (row._id) {
        output = '_id';
      } else if (row.i) {
        output = 'i';
      }
      return output;
    };
    safeCallback = function(callbackName, obj) {
      if (config.callbacks && config.callbacks[callbackName]) {
        return config.callbacks[callbackName](obj);
      }
    };
    attachDatabase = function() {
      var deleteKeys, i, inflate, len, ref, table;
      maintenanceMode = true;
      alasql('CREATE DATABASE ' + settings.DATABASE);
      alasql('USE ' + settings.DATABASE);
      ref = config.tables;
      for (i = 0, len = ref.length; i < len; i++) {
        table = ref[i];
        alasql('CREATE TABLE ' + table);
      }
      database = alasql.databases[settings.DATABASE];
      deleteKeys = function(cb) {
        return storage.keys(null, settings.DATABASE + ':node:', function(e, r) {
          var j, key, len1, ref1;
          if (!e && r && r.Contents) {
            ref1 = r.Contents;
            for (j = 0, len1 = ref1.length; j < len1; j++) {
              key = ref1[j];
              storage.del(key.Key);
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
        return storage.keys(from, settings.DATABASE + ':node:', function(e, r) {
          if (e || !r.Contents) {
            return console.log('error', e);
          }
          return async.eachSeries(r.Contents, function(key, callback) {
            return key.Key.replace(/(.+):(.+):(.+)\/(.+)/, function(all, db, type, table, id) {
              if (db && table && id && db === settings.DATABASE) {
                return storage.get(key.Key, function(e, o) {
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
      if (settings.AWS_OK || settings.LOCAL_STORAGE) {
        return storage.get(settings.DATABASE + ':database', function(e, o) {
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
              return storage.put(settings.DATABASE + ':database', database.tables, function(e) {
                if (!e) {
                  console.log('database updated and uploaded');
                }
                maintenanceMode = false;
                return safeCallback('ready', database);
              });
            });
          });
        });

        /*
        setInterval ->
          maintenanceMode = true
          storage.put settings.DATABASE + ':database', database.tables, (e) ->
            if not e
              console.log 'database uploaded'
              deleteKeys ->
                maintenanceMode = false
            else
              maintenanceMode = false
        , 11 * 60 * 60 * 1000
         */
      } else {
        maintenanceMode = false;
        return safeCallback('ready', database);
      }
    };
    attachDatabase();
    return {
      exec: function(sql, props, notCritical) {
        var delReg, i, len, output, prop, ref, upReg, updateIds, updateTable;
        if (maintenanceMode) {
          return [];
        }
        if (settings.autoId && /INSERT/i.test(sql)) {
          if (Object.prototype.toString.call(props[0]) === '[object Array]') {
            ref = props[0];
            for (i = 0, len = ref.length; i < len; i++) {
              prop = ref[i];
              prop[settings.autoId] = ObjectID.generate();
            }
          } else {
            props[0][settings.autoId] = ObjectID.generate();
          }
        }
        updateIds = [];
        updateTable = '';
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
                delObj[settings.autoId || '_id'] = getId(r);
                if (!notCritical) {
                  storage.put(settings.DATABASE + ':node:' + table + '/' + getId(r), delObj);
                }
                safeCallback('delete', {
                  id: getId(r),
                  table: table,
                  obj: delObj
                });
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
                if (!notCritical) {
                  storage.put(settings.DATABASE + ':node:' + table + '/' + getId(prop), prop);
                }
                results.push(safeCallback('insert', {
                  id: getId(prop),
                  table: table,
                  obj: prop
                }));
              }
              return results;
            } else {
              if (!notCritical) {
                storage.put(settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0]);
              }
              return safeCallback('insert', {
                id: getId(props[0]),
                table: table,
                obj: props[0]
              });
            }
          });
        }
        output = database.exec(sql, props);
        if (updateIds && updateIds.length) {
          async.each(updateIds, function(updateId, callback) {
            var r, res;
            res = database.exec('SELECT * FROM ' + updateTable + ' WHERE ' + getIdField(updateId) + '=?', [getId(updateId)]);
            if (res && res.length) {
              r = res[0];
              if (!notCritical) {
                storage.put(settings.DATABASE + ':node:' + updateTable + '/' + getId(r), r);
              }
              safeCallback('update', {
                id: getId(r),
                table: updateTable,
                obj: r
              });
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
        return storage.put(settings.DATABASE + ':database', database.tables, function(e) {
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
