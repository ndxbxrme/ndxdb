(function() {
  'use strict';
  var ObjectID, alasql, async, attachDatabase, callbacks, config, database, deleteKeys, exec, fs, getId, getIdField, inflate, insert, maintenanceMode, resetSqlCache, restoreDatabase, safeCallback, saveDatabase, settings, sqlCache, sqlCacheSize, storage, update, version;

  fs = require('fs');

  alasql = require('alasql');

  require('./alasql-patch')(alasql);

  async = require('async');

  ObjectID = require('bson-objectid');

  settings = require('./settings');

  storage = require('./storage')();

  version = require('../package.json').version;

  database = null;

  sqlCache = {};

  sqlCacheSize = 0;

  resetSqlCache = function() {
    sqlCache = {};
    return sqlCacheSize = 0;
  };

  config = {};

  maintenanceMode = false;

  callbacks = {
    ready: [],
    insert: [],
    update: [],
    select: [],
    "delete": [],
    restore: []
  };

  restoreDatabase = function(data, cb) {
    var key;
    for (key in data) {
      if (database.tables[key]) {
        database.exec('DELETE FROM ' + key);
        database.exec('INSERT INTO ' + key + ' SELECT * FROM ?', [data[key].data]);
      }
    }
    safeCallback('restore', database);
    return typeof cb === "function" ? cb() : void 0;
  };

  getId = function(row) {
    return row[settings.AUTO_ID] || row.id || row._id || row.i;
  };

  getIdField = function(row) {
    var output;
    output = '_id';
    if (row[settings.AUTO_ID]) {
      output = settings.AUTO_ID;
    } else if (row.id) {
      output = 'id';
    } else if (row._id) {
      output = '_id';
    } else if (row.i) {
      output = 'i';
    }
    return output;
  };

  safeCallback = function(name, obj) {
    var cb, j, len, ref, results;
    ref = callbacks[name];
    results = [];
    for (j = 0, len = ref.length; j < len; j++) {
      cb = ref[j];
      results.push(cb(obj));
    }
    return results;
  };

  deleteKeys = function(cb) {
    return storage.keys(null, settings.DATABASE + ':node:', function(e, r) {
      var j, key, len, ref;
      if (!e && r && r.Contents) {
        ref = r.Contents;
        for (j = 0, len = ref.length; j < len; j++) {
          key = ref[j];
          storage.del(key.Key);
        }
      }
      if (r.IsTruncated) {
        return process.nextTick(function() {
          return deleteKeys(cb);
        });
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
          return typeof cb === "function" ? cb() : void 0;
        }
      });
    });
  };

  saveDatabase = function(cb) {
    return storage.put(settings.DATABASE + ':database', database.tables, function(e) {
      maintenanceMode = false;
      return typeof cb === "function" ? cb() : void 0;
    });
  };

  attachDatabase = function() {
    var j, len, ref, table;
    maintenanceMode = true;
    alasql('CREATE DATABASE ' + settings.DATABASE);
    alasql('USE ' + settings.DATABASE);
    ref = config.tables;
    for (j = 0, len = ref.length; j < len; j++) {
      table = ref[j];
      alasql('CREATE TABLE ' + table);
    }
    database = alasql.databases[settings.DATABASE];
    if (settings.MAXSQLCACHESIZE) {
      alasql.MAXSQLCACHESIZE = settings.MAXSQLCACHESIZE;
    }
    if (settings.AWS_OK || settings.LOCAL_STORAGE) {
      return storage.get(settings.DATABASE + ':database', function(e, o) {
        if (!e && o) {
          restoreDatabase(o);
        }
        return inflate(null, function() {
          return deleteKeys(function() {
            return saveDatabase(function() {
              console.log("ndxdb v" + version + " ready");
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

  exec = function(sql, props, notCritical) {
    var args, ast, error, hash, hh, idProps, idWhere, isDelete, isInsert, isSelect, isUpdate, j, k, l, len, len1, len2, output, prop, ref, ref1, ref2, res, statement, table, updateIds;
    if (maintenanceMode) {
      return [];
    }
    hash = function(str) {
      var h, i;
      h = 5381;
      i = str.length;
      while (i) {
        h = (h * 33) ^ str.charCodeAt(--i);
      }
      return h;
    };
    hh = hash(sql);
    ast = sqlCache[hh];
    if (!ast) {
      ast = alasql.parse(sql);
    }
    if (!(ast.statements && ast.statements.length)) {
      return [];
    } else {
      if (sqlCacheSize > database.MAXSQLCACHESIZE) {
        resetSqlCache();
      }
      sqlCacheSize++;
      sqlCache[hh] = ast;
    }
    args = [].slice.call(arguments);
    args.splice(0, 3);
    error = '';
    ref = ast.statements;
    for (j = 0, len = ref.length; j < len; j++) {
      statement = ref[j];
      table = '';
      if (statement.into) {
        table = statement.into.tableid;
      } else if (statement.table) {
        table = statement.table.tableid;
      } else if (statement.from && statement.from.lenth) {
        table = statement.from[0].tableid;
      }
      isUpdate = statement instanceof alasql.yy.Update;
      isInsert = statement instanceof alasql.yy.Insert;
      isDelete = statement instanceof alasql.yy.Delete;
      isSelect = statement instanceof alasql.yy.Select;
      if (settings.AUTO_ID && isInsert) {
        if (Object.prototype.toString.call(props[0]) === '[object Array]') {
          ref1 = props[0];
          for (k = 0, len1 = ref1.length; k < len1; k++) {
            prop = ref1[k];
            prop[settings.AUTO_ID] = ObjectID.generate();
          }
        } else {
          props[0][settings.AUTO_ID] = ObjectID.generate();
        }
      }
      updateIds = [];
      if (isUpdate) {
        idWhere = '';
        idProps = [];
        if (statement.where) {
          idWhere = ' WHERE ' + statement.where.toString().replace(/\$(\d+)/g, function(all, p) {
            if (props.length > +p) {
              idProps.push(props[+p]);
            }
            return '?';
          });
        }
        updateIds = database.exec('SELECT *, \'' + table + '\' as ndxtable FROM ' + table + idWhere, idProps);
      } else if (isDelete) {
        idWhere = '';
        if (statement.where) {
          idWhere = ' WHERE ' + statement.where.toString().replace(/\$(\d+)/g, '?');
        }
        res = database.exec('SELECT * FROM ' + table + idWhere, props);
        if (res && res.length) {
          async.each(res, function(r, callback) {
            var delObj;
            delObj = {
              '__!deleteMe!': true
            };
            delObj[getIdField(r)] = getId(r);
            storage.put(settings.DATABASE + ':node:' + table + '/' + getId(r), delObj, null, notCritical);
            safeCallback('delete', {
              id: getId(r),
              table: table,
              obj: delObj
            });
            return callback();
          });
        }
      } else if (isInsert) {
        if (Object.prototype.toString.call(props[0]) === '[object Array]') {
          ref2 = props[0];
          for (l = 0, len2 = ref2.length; l < len2; l++) {
            prop = ref2[l];
            if (settings.AUTO_DATE) {
              prop.u = new Date().valueOf();
            }
            storage.put(settings.DATABASE + ':node:' + table + '/' + getId(prop), prop, null, notCritical);
            safeCallback('insert', {
              id: getId(prop),
              table: table,
              obj: prop,
              args: args
            });
          }
        } else {
          if (settings.AUTO_DATE) {
            props[0].u = new Date().valueOf();
          }
          storage.put(settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0], null, notCritical);
          safeCallback('insert', {
            id: getId(props[0]),
            table: table,
            obj: props[0],
            args: args
          });
        }
      }
    }
    output = database.exec(sql, props);
    if (updateIds && updateIds.length) {
      async.each(updateIds, function(updateId, callback) {
        var r;
        if (settings.AUTO_DATE) {
          database.exec('UPDATE ' + updateId.ndxtable + ' SET u=? WHERE ' + getIdField(updateId) + '=?', [new Date().valueOf(), getId(updateId)]);
        }
        res = database.exec('SELECT * FROM ' + updateId.ndxtable + ' WHERE ' + getIdField(updateId) + '=?', [getId(updateId)]);
        if (res && res.length) {
          r = res[0];
          storage.put(settings.DATABASE + ':node:' + updateId.ndxtable + '/' + getId(r), r, null, notCritical);
          safeCallback('update', {
            id: getId(r),
            table: updateId.ndxtable,
            obj: r,
            args: args
          });
        }
        return callback();
      });
    }
    if (isSelect) {
      safeCallback('select', null);
    }
    if (error) {
      output.error = error;
    }
    return output;
  };

  update = function(table, obj, whereSql, whereProps) {
    var key, props, updateProps, updateSql;
    updateSql = [];
    updateProps = [];
    for (key in obj) {
      if (whereProps.indexOf(obj[key]) === -1) {
        updateSql.push(" " + key + "=? ");
        updateProps.push(obj[key]);
      }
    }
    props = updateProps.concat(whereProps);
    return exec("UPDATE " + table + " SET " + (updateSql.join(',')) + " WHERE " + whereSql, props);
  };

  insert = function(table, obj) {
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      return exec("INSERT INTO " + table + " SELECT * FROM ?", [obj]);
    } else {
      return exec("INSERT INTO " + table + " VALUES ?", [obj]);
    }
  };

  module.exports = {
    config: function(_config) {
      config = _config;
      settings.LOCAL_STORAGE = config.localStorage || config.local || settings.LOCAL_STORAGE;
      settings.PREFER_LOCAL = config.preferLocal || settings.PREFER_LOCAL;
      settings.DATABASE = config.database || config.dbname || config.databaseName || settings.DATABASE;
      settings.AUTO_ID = config.autoId || settings.AUTO_ID;
      settings.AUTO_DATE = config.autoDate || settings.AUTO_DATE;
      settings.AWS_BUCKET = config.awsBucket || settings.AWS_BUCKET;
      settings.AWS_REGION = config.awsRegion || settings.AWS_REGION;
      settings.AWS_ID = config.awsId || settings.AWS_ID;
      settings.AWS_KEY = config.awsKey || settings.AWS_KEY;
      settings.MAXSQLCACHESIZE = config.maxSqlCacheSize || settings.MAXSQLCACHESIZE;
      settings.AWS_OK = settings.AWS_BUCKET && settings.AWS_ID && settings.AWS_KEY;
      storage.checkDataDir();
      return this;
    },
    start: function() {
      attachDatabase();
      return this;
    },
    on: function(name, callback) {
      callbacks[name].push(callback);
      return this;
    },
    off: function(name, callback) {
      callbacks[name].splice(callbacks[name].indexOf(callback), 1);
      return this;
    },
    serverExec: function(type, args) {
      var delObj, idField;
      if (maintenanceMode) {
        return [];
      }
      idField = getIdField(args.obj);
      if (type === 'update') {
        database.exec('DELETE FROM ' + args.table + ' WHERE ' + idField + '=?', [args.id]);
        database.exec('INSERT INTO ' + args.table + ' VALUES ?', [args.obj]);
        storage.put(settings.DATABASE + ':node:' + args.table + '/' + args.id, args.obj, null, true);
      } else if (type === 'insert') {
        database.exec('INSERT INTO ' + args.table + ' VALUES ?', [args.obj]);
        storage.put(settings.DATABASE + ':node:' + args.table + '/' + args.id, args.obj, null, true);
      } else if (type === 'delete') {
        database.exec('DELETE FROM ' + args.table + ' WHERE ' + idField + '=?', [args.id]);
        delObj = {
          '__!deleteMe!': true
        };
        delObj[idField] = args.id;
        storage.put(settings.DATABASE + ':node:' + args.table + '/' + args.id, args.obj, null, true);
      }
      return safeCallback(type, args);
    },
    exec: exec,
    update: update,
    insert: insert,
    upsert: function(table, obj, whereSql, whereProps) {
      var test;
      test = database.exec("SELECT * FROM " + table + " WHERE " + whereSql, whereProps);
      if (test && test.length) {
        return update(table, obj, whereSql, whereProps);
      } else {
        return insert(table, obj);
      }
    },
    maintenanceOn: function() {
      return maintenanceMode = true;
    },
    maintenanceOff: function() {
      return maintenanceMode = false;
    },
    version: function() {
      return version;
    },
    maintenance: function() {
      return maintenanceMode;
    },
    getDb: function() {
      return database.tables;
    },
    cacheSize: function() {
      return database.sqlCacheSize;
    },
    restoreFromBackup: function(data) {
      if (data) {
        return restoreDatabase(data, function() {
          return deleteKeys(function() {
            return saveDatabase();
          });
        });
      }
    },
    consolidate: function() {
      return deleteKeys(function() {
        return saveDatabase();
      });
    },
    uploadDatabase: function(cb) {
      return deleteKeys(function() {
        return storage.put(settings.DATABASE + ':database', database.tables, function(e) {
          if (!e) {
            console.log('database uploaded');
          }
          return typeof cb === "function" ? cb() : void 0;
        });
      });
    },
    resetSqlCache: function() {
      return database.resetSqlCache();
    },
    alasql: alasql
  };

}).call(this);

//# sourceMappingURL=database.js.map
