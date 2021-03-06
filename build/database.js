(function() {
  'use strict';
  var DeepDiff, ObjectID, alasql, async, asyncCallback, attachDatabase, callbacks, cleanObj, consolidate, consolidateCheck, count, database, del, deleteKeys, exec, fs, getId, getIdField, inflate, insert, maintenanceMode, makeWhere, maxModified, ndx, objtrans, readDiffs, resetSqlCache, restoreDatabase, restoreFromBackup, s, saveDatabase, select, selectOne, settings, sqlCache, sqlCacheSize, storage, syncCallback, update, upgradeDatabase, upsert, version;

  fs = require('fs');

  alasql = require('alasql');

  require('./alasql-patch')(alasql);

  async = require('async');

  ObjectID = require('bson-objectid');

  objtrans = require('objtrans');

  settings = require('./settings');

  storage = null;

  s = require('underscore.string');

  DeepDiff = require('deep-diff').diff;

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
    delete: [],
    preInsert: [],
    preUpdate: [],
    preSelect: [],
    preDelete: [],
    selectTransform: [],
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
    var callback, j, len, ref;
    if (callbacks[name] && callbacks[name].length) {
      ref = callbacks[name];
      for (j = 0, len = ref.length; j < len; j++) {
        callback = ref[j];
        callback(obj);
      }
    }
    return typeof cb === "function" ? cb() : void 0;
  };

  asyncCallback = function(name, obj, cb) {
    var truth;
    truth = false;
    if (callbacks[name] && callbacks[name].length) {
      return async.eachSeries(callbacks[name], function(cbitem, callback) {
        return cbitem(obj, function(result) {
          truth = truth || result;
          return callback();
        });
      }, function() {
        return typeof cb === "function" ? cb(truth) : void 0;
      });
    } else {
      return typeof cb === "function" ? cb(true) : void 0;
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

  readDiffs = function(from, to, out) {
    var dif, diffs, good, j, len, myout, mypath;
    diffs = DeepDiff(from, to);
    out = out || {};
    if (diffs) {
      for (j = 0, len = diffs.length; j < len; j++) {
        dif = diffs[j];
        switch (dif.kind) {
          case 'E':
          case 'N':
            myout = out;
            mypath = dif.path.join('.');
            good = true;
            if (dif.lhs && dif.rhs && typeof dif.lhs !== typeof dif.rhs) {
              if (dif.lhs.toString() === dif.rhs.toString()) {
                good = false;
              }
            }
            if (good) {
              myout[mypath] = {};
              myout = myout[mypath];
              myout.from = dif.lhs;
              myout.to = dif.rhs;
            }
        }
      }
    }
    return out;
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
          if (db && table && id && db.substr(db.lastIndexOf('/') + 1) === settings.DATABASE) {
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
                  console.log(`ndxdb v${version} ready`);
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
        console.log(`ndxdb v${version} ready`);
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
                console.log(`ndxdb v${version} ready`);
                return syncCallback('ready', database);
              });
            });
          }, storage.getOld);
        });
      } else if (e === 'ENOENT') {
        console.log('building new database');
        return inflate(null, function() {
          return deleteKeys(function() {
            return saveDatabase(function() {
              console.log(`ndxdb v${version} ready`);
              return syncCallback('ready', database);
            });
          });
        });
      } else {
        return console.log('\nerror decrypting database.  \nif you have changed the encryption key and want to save your data use ndx-framework to upgrade the database otherwise delete the data directory and restart the app');
      }
    });
  };

  restoreFromBackup = function(readStream) {
    return new Promise(function(resolve) {
      maintenanceMode = true;
      return storage.get('', function(e, o) {
        if (!e && o) {
          return restoreDatabase(o, function() {
            return deleteKeys(function() {
              return saveDatabase(function() {
                console.log("backup restored");
                syncCallback('restore', null);
                return resolve();
              });
            });
          });
        }
      }, readStream);
    });
  };

  exec = function(sql, props, notCritical, isServer, cb, changes) {
    var args, ast, error, hash, hh, idProps, idWhere, isDelete, isInsert, isSelect, isUpdate, j, k, l, len, len1, len2, myCb, output, prop, ref, ref1, ref2, res, statement, table, updateIds;
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
              op: 'delete',
              id: getId(r),
              table: table,
              obj: delObj,
              user: ndx.user,
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
              op: 'insert',
              id: getId(prop),
              table: table,
              obj: prop,
              args: args,
              user: ndx.user,
              isServer: isServer
            });
          }
        } else {
          if (settings.AUTO_DATE) {
            props[0].u = new Date().valueOf();
          }
          storage.put(settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0], null, notCritical);
          asyncCallback((isServer ? 'serverInsert' : 'insert'), {
            op: 'insert',
            id: getId(props[0]),
            table: table,
            obj: props[0],
            user: ndx.user,
            args: args,
            isServer: isServer
          });
        }
      }
    }
    myCb = function() {
      if (isInsert || isUpdate) {
        return typeof cb === "function" ? cb(prop || props[0]) : void 0;
      } else {
        return cb != null ? cb.apply(this, arguments) : void 0;
      }
    };
    output = database.exec(sql, props, myCb);
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
            op: 'update',
            id: getId(r),
            table: updateId.ndxtable,
            obj: r,
            args: args,
            changes: changes,
            user: ndx.user,
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

  maxModified = function(table, cb) {
    return database.exec('SELECT MAX(modifiedAt) as maxModified FROM ' + table, null, function(result) {
      maxModified = 0;
      if (result && result.length) {
        maxModified = result[0].maxModified || 0;
      }
      return typeof cb === "function" ? cb(maxModified) : void 0;
    });
  };

  makeWhere = function(whereObj) {
    var parent, parse, props, sql;
    if (!whereObj || whereObj.sort || whereObj.sortDir || whereObj.pageSize) {
      return {
        sql: ''
      };
    }
    props = [];
    parent = '';
    parse = function(obj, op, comp) {
      var andsql, j, k, key, len, len1, objsql, orsql, ref, ref1, sql, thing, writeVal;
      sql = '';
      writeVal = function(key, comp) {
        var fullKey;
        fullKey = `${parent}\`${key}\``.replace(/\./g, '->');
        fullKey = fullKey.replace(/->`\$[a-z]+`$/, '');
        if (obj[key] === null) {
          if (key === '$ne' || key === '$neq') {
            return sql += ` ${op} ${fullKey} IS NOT NULL`;
          } else {
            return sql += ` ${op} ${fullKey} IS NULL`;
          }
        } else {
          sql += ` ${op} ${fullKey} ${comp} ?`;
          return props.push(obj[key]);
        }
      };
      for (key in obj) {
        if (obj.hasOwnProperty(key)) {
          if (key === '$or') {
            orsql = '';
            ref = obj[key];
            for (j = 0, len = ref.length; j < len; j++) {
              thing = ref[j];
              objsql = parse(thing, 'AND', comp).replace(/^ AND /, '');
              if (/ AND | OR /.test(objsql) && objsql.indexOf('(') !== 0) {
                objsql = `(${objsql})`;
              }
              orsql += ' OR ' + objsql;
            }
            sql += ` ${op} (${orsql})`.replace(/\( OR /g, '(');
          } else if (key === '$and') {
            andsql = '';
            ref1 = obj[key];
            for (k = 0, len1 = ref1.length; k < len1; k++) {
              thing = ref1[k];
              andsql += parse(thing, 'AND', comp);
            }
            sql += ` ${op} (${andsql})`.replace(/\( AND /g, '(');
          } else if (key === '$gt') {
            writeVal(key, '>');
          } else if (key === '$lt') {
            writeVal(key, '<');
          } else if (key === '$gte') {
            writeVal(key, '>=');
          } else if (key === '$lte') {
            writeVal(key, '<=');
          } else if (key === '$eq') {
            writeVal(key, '=');
          } else if (key === '$neq') {
            writeVal(key, '!=');
          } else if (key === '$ne') {
            writeVal(key, '!=');
          } else if (key === '$in') {
            writeVal(key, 'IN');
          } else if (key === '$nin') {
            writeVal(key, 'NOT IN');
          } else if (key === '$like') {
            sql += ` ${op} ${parent.replace(/->$/, '')} LIKE '%${obj[key]}%'`;
            parent = '';
          } else if (key === '$null') {
            sql += ` ${op} ${parent.replace(/->$/, '')} IS NULL`;
            parent = '';
          } else if (key === '$nnull') {
            sql += ` ${op} ${parent.replace(/->$/, '')} IS NOT NULL`;
            parent = '';
          } else if (key === '$nn') {
            sql += ` ${op} ${parent.replace(/->$/, '')} IS NOT NULL`;
            parent = '';
          } else if (Object.prototype.toString.call(obj[key]) === '[object Object]') {
            parent += '`' + key + '`->';
            sql += parse(obj[key], op, comp);
          } else {
            writeVal(key, comp);
          }
        }
      }
      parent = '';
      return sql;
    };
    delete whereObj['#'];
    sql = parse(whereObj, 'AND', '=').replace(/(^|\() (AND|OR) /g, '$1');
    return {
      sql: sql,
      props: props
    };
  };

  select = function(table, args, cb, isServer) {
    return new Promise(function(resolve, reject) {
      return (function(user) {
        return asyncCallback((isServer ? 'serverPreSelect' : 'preSelect'), {
          op: 'select',
          table: table,
          args: args,
          user: user
        }, function(result) {
          var bit, i, key, myCb, mykey, output, sorting, where;
          if (!result) {
            resolve([]);
            return typeof cb === "function" ? cb([], 0) : void 0;
          }
          args = args || {};
          where = makeWhere(args.where ? args.where : args);
          sorting = '';
          if (args.sort) {
            if (Object.prototype.toString.call(args.sort) === '[object Object]') {
              sorting += ' ORDER BY ';
              i = 0;
              for (key in args.sort) {
                if (i++ > 0) {
                  sorting += ', ';
                }
                bit = args.sort[key];
                mykey = key.replace(/\./g, '->');
                if (bit === 1 || bit === 'ASC') {
                  sorting += `\`${mykey}\` ASC`;
                } else {
                  sorting += `\`${mykey}\` DESC`;
                }
              }
            } else {
              args.sort = args.sort.replace(/\./g, '->');
              sorting += ` ORDER BY \`${args.sort}\``;
              if (args.sortDir) {
                sorting += ` ${args.sortDir}`;
              }
            }
          }
          if (where.sql) {
            where.sql = ` WHERE ${where.sql}`;
          }
          myCb = function(output) {
            return asyncCallback((isServer ? 'serverSelect' : 'select'), {
              op: 'select',
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
              return asyncCallback((isServer ? 'serverSelectTransform' : 'selectTransform'), {
                op: 'select',
                transformer: args.transformer,
                table: table,
                objs: output,
                isServer: isServer,
                user: user
              }, function() {
                ndx.user = user;
                resolve(output);
                return typeof cb === "function" ? cb(output, total) : void 0;
              });
            });
          };
          ndx.user = user;
          return output = exec(`SELECT * FROM ${table}${where.sql}${sorting}`, where.props, null, isServer, myCb);
        });
      })(ndx.user);
    });
  };

  selectOne = async function(table, args, cb, isServer) {
    var output;
    output = (await select(table, args, null, isServer));
    if (output && output.length) {
      return output[0];
    } else {
      return null;
    }
  };

  count = function(table, whereObj, cb, isServer) {
    var res, where;
    where = makeWhere(whereObj);
    if (where.sql) {
      where.sql = ` WHERE ${where.sql}`;
    }
    res = exec(`SELECT COUNT(*) AS c FROM ${table}${where.sql}`, where.props, null, isServer, cb);
    if (res && res.length) {
      return res[0].c;
    }
    return 0;
  };

  cleanObj = function(obj) {
    var key;
    for (key in obj) {
      if (key.indexOf('$') === 0 || key === '#' || !obj.hasOwnProperty(key)) {
        delete obj[key];
      }
    }
  };

  update = function(table, obj, whereObj, cb, isServer) {
    var where;
    cleanObj(obj);
    where = makeWhere(whereObj);
    if (where.sql) {
      where.sql = ` WHERE ${where.sql}`;
    }
    return (function(user) {
      return exec(`SELECT * FROM ${table}${where.sql}`, where.props, null, true, function(oldItems) {
        if (oldItems) {
          return async.each(oldItems, function(oldItem, diffCb) {
            var diffs, id;
            diffs = readDiffs(oldItem, obj);
            id = getId(oldItem);
            return asyncCallback((isServer ? 'serverPreUpdate' : 'preUpdate'), {
              op: 'update',
              id: id,
              table: table,
              obj: obj,
              oldObj: oldItem,
              where: whereObj,
              changes: diffs,
              user: user
            }, function(result) {
              var key, updateProps, updateSql;
              if (!result) {
                return typeof cb === "function" ? cb([]) : void 0;
              }
              updateSql = [];
              updateProps = [];
              for (key in obj) {
                if (where.props.indexOf(obj[key]) === -1) {
                  updateSql.push(` \`${key}\`=? `);
                  updateProps.push(obj[key]);
                }
              }
              updateProps.push(id);
              ndx.user = user;
              return exec(`UPDATE ${table} SET ${updateSql.join(',')} WHERE \`${[settings.AUTO_ID]}\`= ?`, updateProps, null, isServer, diffCb, diffs);
            });
          }, function() {
            return typeof cb === "function" ? cb([]) : void 0;
          });
        } else {
          return typeof cb === "function" ? cb([]) : void 0;
        }
      });
    })(ndx.user);
  };

  insert = function(table, obj, cb, isServer) {
    return new Promise(function(resolve, reject) {
      cleanObj(obj);
      return (function(user) {
        var myCb;
        myCb = function() {
          resolve.apply(this, arguments);
          return cb != null ? cb.apply(this, arguments) : void 0;
        };
        return asyncCallback((isServer ? 'serverPreInsert' : 'preInsert'), {
          op: 'insert',
          table: table,
          obj: obj,
          user: user
        }, function(result) {
          if (!result) {
            return typeof myCb === "function" ? myCb(null) : void 0;
          }
          ndx.user = user;
          if (Object.prototype.toString.call(obj) === '[object Array]') {
            return exec(`INSERT INTO ${table} SELECT * FROM ?`, [obj], null, isServer, myCb);
          } else {
            return exec(`INSERT INTO ${table} VALUES ?`, [obj], null, isServer, myCb);
          }
        });
      })(ndx.user);
    });
  };

  upsert = function(table, obj, whereObj, cb, isServer) {
    var test, where;
    where = makeWhere(whereObj);
    if (!whereObj && obj[settings.AUTO_ID]) {
      whereObj = {};
      whereObj[settings.AUTO_ID] = obj[settings.AUTO_ID];
      where = makeWhere(whereObj);
    }
    if (where.sql) {
      where.sql = ` WHERE ${where.sql}`;
    }
    test = exec(`SELECT * FROM ${table}${where.sql}`, where.props, null, isServer);
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
      where.sql = ` WHERE ${where.sql}`;
    }
    return (function(user) {
      return asyncCallback((isServer ? 'serverPreDelete' : 'preDelete'), {
        op: 'delete',
        table: table,
        where: whereObj,
        user: user
      }, function(result) {
        if (!result) {
          if (typeof cb === "function") {
            cb([]);
          }
        }
        ndx.user = user;
        return exec(`DELETE FROM ${table}${where.sql}`, where.props, null, isServer, cb);
      });
    })(ndx.user);
  };

  consolidate = function() {
    return new Promise(function(resolve, reject) {
      return deleteKeys(function() {
        return saveDatabase(resolve);
      });
    });
  };

  consolidateCheck = function() {
    return storage.keys(null, settings.DATABASE + ':node:', function(e, r) {
      if (r && r.Contents && r.Contents.length > (+settings.CONSOLIDATE_COUNT || 500)) {
        return consolidate();
      }
    });
  };

  module.exports = {
    config: function(config) {
      var key, keyU;
      for (key in config) {
        keyU = s(key).underscored().value().toUpperCase();
        settings[keyU] = config[key] || config[keyU] || settings[keyU];
      }
      settings.AWS_BUCKET = settings.AWS_BUCKET || process.env.AWS_BUCKET;
      settings.AWS_ID = settings.AWS_ID || process.env.AWS_ID;
      settings.AWS_KEY = settings.AWS_KEY || process.env.AWS_KEY;
      settings.AWS_OK = settings.AWS_BUCKET && settings.AWS_ID && settings.AWS_KEY;
      settings.MAX_SQL_CACHE_SIZE = settings.MAX_SQL_CACHE_SIZE || process.env.MAX_SQL_CACHE_SIZE || 100;
      settings.ENCRYPTION_KEY = settings.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
      settings.ENCRYPTION_ALGORITHM = settings.ENCRYPTION_ALGORITHM || process.env.ENCRYPTION_ALGORITHM;
      settings.DO_NOT_ENCRYPT = settings.DO_NOT_ENCRYPT || process.env.DO_NOT_ENCRYPT;
      if (!settings.AUTO_ID) {
        settings.AUTO_ID = '_id';
      }
      storage = require('./storage')();
      storage.checkDataDir();
      return this;
    },
    start: function() {
      attachDatabase();
      setInterval(consolidateCheck, (+settings.CONSOLIDATE_MINS || 60) * 60 * 1000);
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
    selectOne: selectOne,
    count: count,
    update: update,
    insert: insert,
    upsert: upsert,
    delete: del,
    bindFns: function(user) {
      return console.log('bindFns');
    },
    maxModified: maxModified,
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
    consolidate: consolidate,
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
    alasql: alasql,
    makeSlug: function(table, template, data, cb) {
      var outSlug, slug, testSlug;
      slug = s(ndx.fillTemplate(template, data)).prune(30, '').slugify().value();
      if (data.slug && data.slug.indexOf(slug) === 0) {
        return cb(true);
      }
      testSlug = slug;
      outSlug = null;
      return async.whilst(function() {
        return outSlug === null;
      }, (callback) => {
        return this.select(table, {
          slug: testSlug
        }, function(results) {
          if (results && results.length) {
            testSlug = slug + '-' + Math.floor(Math.random() * 9999);
          } else {
            outSlug = testSlug;
          }
          return callback(null, outSlug);
        }, true);
      }, function(err, slug) {
        data.slug = slug;
        return typeof cb === "function" ? cb(true) : void 0;
      });
    }
  };

}).call(this);

//# sourceMappingURL=database.js.map
