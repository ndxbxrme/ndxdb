(function() {
  'use strict';
  var ObjectID, alasql, async, asyncCallback, attachDatabase, callbacks, camelize, cleanObj, count, database, del, deleteKeys, exec, fs, getId, getIdField, humanize, inflate, insert, maintenanceMode, makeWhere, ndx, objtrans, resetSqlCache, restoreDatabase, restoreFromBackup, saveDatabase, select, settings, sqlCache, sqlCacheSize, storage, syncCallback, underscored, update, upgradeDatabase, upsert, version;

  fs = require('fs');

  alasql = require('alasql');

  require('./alasql-patch')(alasql);

  async = require('async');

  ObjectID = require('bson-objectid');

  objtrans = require('objtrans');

  settings = require('./settings');

  storage = null;

  underscored = require('underscore.string').underscored;

  humanize = require('underscore.string').humanize;

  camelize = require('underscore.string').camelize;

  version = require('../package.json').version;

  database = null;

  ndx = {};

  sqlCache = {};

  sqlCacheSize = 0;

  resetSqlCache = function() {
    sqlCache = {};
    return sqlCacheSize = 0;
  };

  maintenanceMode = false;

  callbacks = {
    ready: [],
    insert: [],
    update: [],
    select: [],
    "delete": [],
    preInsert: [],
    preUpdate: [],
    preSelect: [],
    preDelete: [],
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
    syncCallback('restore', database);
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

  syncCallback = function(name, obj, cb) {
    var callback, j, len, ref, truth;
    truth = true;
    if (callbacks[name] && callbacks[name].length) {
      ref = callbacks[name];
      for (j = 0, len = ref.length; j < len; j++) {
        callback = ref[j];
        truth = truth && callback(obj);
      }
    }
    return typeof cb === "function" ? cb(truth) : void 0;
  };

  asyncCallback = function(name, obj, cb) {
    var truth;
    truth = true;
    if (callbacks[name] && callbacks[name].length) {
      return async.eachSeries(callbacks[name], function(cbitem, callback) {
        return cbitem(obj, function(result) {
          truth = truth && result;
          return callback();
        });
      }, function() {
        return typeof cb === "function" ? cb(truth) : void 0;
      });
    } else {
      return typeof cb === "function" ? cb(truth) : void 0;
    }
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

  inflate = function(from, cb, getFn) {
    if (!getFn) {
      getFn = storage.get;
    }
    return storage.keys(from, settings.DATABASE + ':node:', function(e, r) {
      if (e || !r.Contents) {
        return console.log('error', e);
      }
      return async.eachSeries(r.Contents, function(key, callback) {
        return key.Key.replace(/(.+):(.+):(.+)\/(.+)(:.+)*/, function(all, db, type, table, id, randId) {
          if (db && table && id && db === settings.DATABASE) {
            return getFn(key.Key, function(e, o) {
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

  saveDatabase = function(cb, writeStream) {
    return storage.put(settings.DATABASE + ':database', database.tables, function(e) {
      maintenanceMode = false;
      return typeof cb === "function" ? cb() : void 0;
    }, false, writeStream);
  };

  attachDatabase = function() {
    var j, len, ref, table;
    maintenanceMode = true;
    alasql('CREATE DATABASE ' + settings.DATABASE);
    alasql('USE ' + settings.DATABASE);
    ref = settings.TABLES;
    for (j = 0, len = ref.length; j < len; j++) {
      table = ref[j];
      alasql('CREATE TABLE ' + table);
    }
    database = alasql.databases[settings.DATABASE];
    if (settings.MAX_SQL_CACHE_SIZE) {
      alasql.MAXSQLCACHESIZE = settings.MAX_SQL_CACHE_SIZE;
    }
    if (settings.AWS_OK || settings.LOCAL_STORAGE) {
      return storage.get(settings.DATABASE + ':database', function(e, o) {
        if (!e && o) {
          return restoreDatabase(o, function() {
            return inflate(null, function() {
              return deleteKeys(function() {
                return saveDatabase(function() {
                  console.log("ndxdb v" + version + " ready");
                  return syncCallback('ready', database);
                });
              });
            });
          });
        } else {
          return upgradeDatabase();
        }
      });
    } else {
      maintenanceMode = false;
      return setImmediate(function() {
        console.log("ndxdb v" + version + " ready");
        return syncCallback('ready', database);
      });
    }
  };

  upgradeDatabase = function() {
    return storage.getOld(settings.DATABASE + ':database', function(e, o) {
      if (!e && o) {
        console.log('upgrading database');
        return restoreDatabase(o, function() {
          return inflate(null, function() {
            return deleteKeys(function() {
              return saveDatabase(function() {
                console.log("ndxdb v" + version + " ready");
                return syncCallback('ready', database);
              });
            });
          }, storage.getOld);
        });
      } else {
        console.log('building new database');
        return inflate(null, function() {
          return deleteKeys(function() {
            return saveDatabase(function() {
              console.log("ndxdb v" + version + " ready");
              return syncCallback('ready', database);
            });
          });
        });
      }
    });
  };

  restoreFromBackup = function(readStream) {
    maintenanceMode = true;
    return storage.get('', function(e, o) {
      if (!e && o) {
        return restoreDatabase(o, function() {
          return deleteKeys(function() {
            return saveDatabase(function() {
              console.log("backup restored");
              return syncCallback('restore', null);
            });
          });
        });
      }
    }, readStream);
  };

  exec = function(sql, props, notCritical, isServer, cb) {
    var args, ast, error, hash, hh, idProps, idWhere, isDelete, isInsert, isSelect, isUpdate, j, k, l, len, len1, len2, output, prop, ref, ref1, ref2, res, statement, table, updateIds;
    if (maintenanceMode) {
      if (typeof cb === "function") {
        cb([]);
      }
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
      if (typeof cb === "function") {
        cb([]);
      }
      return [];
    } else {
      if (sqlCacheSize > database.MAX_SQL_CACHE_SIZE) {
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
      isUpdate = statement instanceof alasql.yy.Update;
      isInsert = statement instanceof alasql.yy.Insert;
      isDelete = statement instanceof alasql.yy.Delete;
      isSelect = statement instanceof alasql.yy.Select;
      if (statement.into) {
        table = statement.into.tableid;
        isInsert = true;
        isSelect = false;
      } else if (statement.table) {
        table = statement.table.tableid;
      } else if (statement.from && statement.from.lenth) {
        table = statement.from[0].tableid;
      }
      if (settings.AUTO_ID && isInsert) {
        if (Object.prototype.toString.call(props[0]) === '[object Array]') {
          ref1 = props[0];
          for (k = 0, len1 = ref1.length; k < len1; k++) {
            prop = ref1[k];
            if (!prop[settings.AUTO_ID]) {
              prop[settings.AUTO_ID] = ObjectID.generate();
            }
          }
        } else {
          if (!props[0][settings.AUTO_ID]) {
            props[0][settings.AUTO_ID] = ObjectID.generate();
          }
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
            asyncCallback((isServer ? 'serverDelete' : 'delete'), {
              id: getId(r),
              table: table,
              obj: delObj,
              isServer: isServer
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
            asyncCallback((isServer ? 'serverInsert' : 'insert'), {
              id: getId(prop),
              table: table,
              obj: prop,
              args: args,
              isServer: isServer
            });
          }
        } else {
          if (settings.AUTO_DATE) {
            props[0].u = new Date().valueOf();
          }
          storage.put(settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0], null, notCritical);
          asyncCallback((isServer ? 'serverInsert' : 'insert'), {
            id: getId(props[0]),
            table: table,
            obj: props[0],
            args: args,
            isServer: isServer
          });
        }
      }
    }
    output = database.exec(sql, props, cb);
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
          asyncCallback((isServer ? 'serverUpdate' : 'update'), {
            id: getId(r),
            table: updateId.ndxtable,
            obj: r,
            args: args,
            isServer: isServer
          });
        }
        return callback();
      });
    }
    if (error) {
      output.error = error;
    }
    return output;
  };

  makeWhere = function(whereObj) {
    var parent, parse, props, sql;
    if (!whereObj || whereObj.sort || whereObj.sortDir || whereObj.pageSize) {
      return {
        sql: ''
      };
    }
    sql = '';
    props = [];
    parent = '';
    parse = function(obj, op, comp) {
      var key;
      sql = '';
      for (key in obj) {
        if (key === '$or') {
          sql += (" " + op + " (" + (parse(obj[key], 'OR', comp)) + ")").replace(/\( OR /g, '(');
        } else if (key === '$gt') {
          sql += parse(obj[key], op, '>');
        } else if (key === '$lt') {
          sql += parse(obj[key], op, '<');
        } else if (key === '$gte') {
          sql += parse(obj[key], op, '>=');
        } else if (key === '$lte') {
          sql += parse(obj[key], op, '<=');
        } else if (key === '$like') {
          sql += " " + op + " " + (parent.replace('->', '')) + " LIKE '%" + obj[key] + "%'";
          parent = '';
        } else if (Object.prototype.toString.call(obj[key]) === '[object Object]') {
          parent += key + '->';
          sql += parse(obj[key], op, comp);
        } else {
          sql += " " + op + " " + parent + key + " " + comp + " ?";
          props.push(obj[key]);
          parent = '';
        }
      }
      return sql;
    };
    sql = parse(whereObj, 'AND', '=').replace(/(^|\() (AND|OR) /g, '$1');
    return {
      sql: sql,
      props: props
    };
  };

  select = function(table, args, cb, isServer) {
    return (function(user) {
      return asyncCallback((isServer ? 'serverPreSelect' : 'preSelect'), {
        table: table,
        args: args,
        user: user
      }, function(result) {
        var myCb, output, sorting, where;
        if (!result) {
          return typeof cb === "function" ? cb([], 0) : void 0;
        }
        args = args || {};
        where = makeWhere(args.where ? args.where : args);
        sorting = '';
        if (args.sort) {
          sorting += " ORDER BY " + args.sort;
          if (args.sortDir) {
            sorting += " " + args.sortDir;
          }
        }
        if (where.sql) {
          where.sql = " WHERE " + where.sql;
        }
        myCb = function(output) {
          return asyncCallback((isServer ? 'serverSelect' : 'select'), {
            table: table,
            objs: output,
            isServer: isServer,
            user: user
          }, function() {
            var total;
            total = output.length;
            if (args.page || args.pageSize) {
              args.page = args.page || 1;
              args.pageSize = args.pageSize || 10;
              output = output.splice((args.page - 1) * args.pageSize, args.pageSize);
            }
            return typeof cb === "function" ? cb(output, total) : void 0;
          });
        };
        return output = exec("SELECT * FROM " + table + where.sql + sorting, where.props, null, isServer, myCb);
      });
    })(ndx.user);
  };

  count = function(table, whereObj, cb, isServer) {
    var res, where;
    where = makeWhere(whereObj);
    if (where.sql) {
      where.sql = " WHERE " + where.sql;
    }
    res = exec("SELECT COUNT(*) AS c FROM " + table + where.sql, where.props, null, isServer, cb);
    if (res && res.length) {
      return res[0].c;
    }
    return 0;
  };

  cleanObj = function(obj) {
    var key;
    for (key in obj) {
      if (key.indexOf('$') === 0) {
        delete obj[key];
      }
    }
  };

  update = function(table, obj, whereObj, cb, isServer) {
    cleanObj(obj);
    return (function(user) {
      return asyncCallback((isServer ? 'serverPreUpdate' : 'preUpdate'), {
        id: getId(obj),
        table: table,
        obj: obj,
        where: whereObj,
        user: user
      }, function(result) {
        var key, props, updateProps, updateSql, where;
        if (!result) {
          return typeof cb === "function" ? cb([]) : void 0;
        }
        updateSql = [];
        updateProps = [];
        where = makeWhere(whereObj);
        if (where.sql) {
          where.sql = " WHERE " + where.sql;
        }
        for (key in obj) {
          if (where.props.indexOf(obj[key]) === -1) {
            updateSql.push(" `" + key + "`=? ");
            updateProps.push(obj[key]);
          }
        }
        props = updateProps.concat(where.props);
        return exec("UPDATE " + table + " SET " + (updateSql.join(',')) + where.sql, props, null, isServer, cb);
      });
    })(ndx.user);
  };

  insert = function(table, obj, cb, isServer) {
    cleanObj(obj);
    return (function(user) {
      return asyncCallback((isServer ? 'serverPreInsert' : 'preInsert'), {
        table: table,
        obj: obj,
        user: user
      }, function(result) {
        if (!result) {
          return typeof cb === "function" ? cb([]) : void 0;
        }
        if (Object.prototype.toString.call(obj) === '[object Array]') {
          return exec("INSERT INTO " + table + " SELECT * FROM ?", [obj], null, isServer, cb);
        } else {
          return exec("INSERT INTO " + table + " VALUES ?", [obj], null, isServer, cb);
        }
      });
    })(ndx.user);
  };

  upsert = function(table, obj, whereObj, cb, isServer) {
    var test, where;
    where = makeWhere(whereObj);
    if (where.sql) {
      where.sql = " WHERE " + where.sql;
    }
    test = exec("SELECT * FROM " + table + where.sql, where.props, null, isServer);
    if (test && test.length && where.sql) {
      return update(table, obj, whereObj, cb, isServer);
    } else {
      return insert(table, obj, cb, isServer);
    }
  };

  del = function(table, whereObj, cb, isServer) {
    var where;
    where = makeWhere(whereObj);
    if (where.sql) {
      where.sql = " WHERE " + where.sql;
    }
    return (function(user) {
      return asyncCallback((isServer ? 'serverPreDelete' : 'preDelete'), {
        table: table,
        where: whereObj,
        user: user
      }, function(result) {
        if (!result) {
          if (typeof cb === "function") {
            cb([]);
          }
        }
        return exec("DELETE FROM " + table + where.sql, where.props, null, isServer, cb);
      });
    })(ndx.user);
  };

  module.exports = {
    config: function(config) {
      var key, keyU;
      for (key in config) {
        keyU = underscored(key).toUpperCase();
        settings[keyU] = config[key] || config[keyU] || settings[keyU];
      }
      settings.AWS_BUCKET = settings.AWS_BUCKET || process.env.AWS_BUCKET;
      settings.AWS_ID = settings.AWS_ID || process.env.AWS_ID;
      settings.AWS_KEY = settings.AWS_KEY || process.env.AWS_KEY;
      settings.AWS_OK = settings.AWS_BUCKET && settings.AWS_ID && settings.AWS_KEY;
      settings.MAX_SQL_CACHE_SIZE = settings.MAX_SQL_CACHE_SIZE || process.env.MAX_SQL_CACHE_SIZE || 100;
      settings.ENCRYPTION_KEY = settings.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
      settings.DO_NOT_ENCRYPT = settings.DO_NOT_ENCRYPT || process.env.DO_NOT_ENCRYPT;
      storage = require('./storage')();
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
      return asyncCallback(type, args);
    },
    exec: exec,
    select: select,
    count: count,
    update: update,
    insert: insert,
    upsert: upsert,
    "delete": del,
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
    saveDatabase: saveDatabase,
    restoreFromBackup: restoreFromBackup,
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
    setNdx: function(_ndx) {
      ndx = _ndx;
      return this;
    },
    alasql: alasql
  };

}).call(this);

//# sourceMappingURL=database.js.map
