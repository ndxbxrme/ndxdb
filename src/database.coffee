'use strict'

fs = require 'fs'
alasql = require 'alasql'
require('./alasql-patch') alasql
async = require 'async'
ObjectID = require 'bson-objectid'
objtrans = require 'objtrans'
settings = require './settings'
storage = null
underscored = require('underscore.string').underscored
humanize = require('underscore.string').humanize
camelize = require('underscore.string').camelize
version = require('../package.json').version
database = null
ndx = {}
sqlCache = {}
sqlCacheSize = 0
resetSqlCache = ->
  sqlCache = {}
  sqlCacheSize = 0
maintenanceMode = false
callbacks =
  ready: []
  insert: []
  update: []
  select: []
  delete: []
  preInsert: []
  preUpdate: []
  preSelect: []
  preDelete: []
  restore: []
restoreDatabase = (data, cb) ->
  for key of data
    if database.tables[key]
      database.exec 'DELETE FROM ' + key
      database.exec 'INSERT INTO ' + key + ' SELECT * FROM ?', [data[key].data]
  syncCallback 'restore', database
  cb?()
getId = (row) ->
  row[settings.AUTO_ID] or row.id or row._id or row.i
getIdField = (row) ->
  output = '_id'
  if row[settings.AUTO_ID] then output = settings.AUTO_ID
  else if row.id then output = 'id'
  else if row._id then output = '_id'
  else if row.i then output = 'i'
  output
syncCallback = (name, obj, cb) ->
  truth = true
  if callbacks[name] and callbacks[name].length
    for callback in callbacks[name]
      truth = truth and callback obj
  cb? truth
asyncCallback = (name, obj, cb) ->
  truth = false
  if callbacks[name] and callbacks[name].length
    async.eachSeries callbacks[name], (cbitem, callback) ->
      cbitem obj, (result) ->
        truth = truth or result
        callback()
    , ->
      cb? truth
  else
    cb? true
deleteKeys = (cb) ->
  storage.keys null, settings.DATABASE + ':node:', (e, r) ->
    if not e and r and r.Contents
      for key in r.Contents
        storage.del key.Key
    if r.IsTruncated
      process.nextTick ->
        deleteKeys cb
    else
      cb()
inflate = (from, cb, getFn) ->
  if not getFn
    getFn = storage.get
  storage.keys from, settings.DATABASE + ':node:', (e, r) ->
    if e or not r.Contents
      return console.log 'error', e
    async.eachSeries r.Contents, (key, callback) ->
      key.Key.replace /(.+):(.+):(.+)\/(.+)(:.+)*/, (all, db, type, table, id, randId) ->
        if db and table and id and db is settings.DATABASE
          getFn key.Key, (e, o) ->
            if e
              return callback()
            idField = getIdField o
            if o[idField]
              database.exec 'DELETE FROM ' + table + ' WHERE ' + idField + '=?', [o[idField]]
              if not o['__!deleteMe!']
                database.exec 'INSERT INTO ' + table + ' VALUES ?', [o]
            return callback()
        else
          callback()
    , ->
      if r.IsTruncated
        inflate r.Contents[r.Contents.length-1].Key, cb
      else
        cb?()
saveDatabase = (cb, writeStream) ->
  storage.put settings.DATABASE + ':database', database.tables, (e) ->
    maintenanceMode = false
    cb?()
  , false, writeStream
attachDatabase = ->
  maintenanceMode = true
  alasql 'CREATE DATABASE ' + settings.DATABASE
  alasql 'USE ' + settings.DATABASE
  for table in settings.TABLES
    alasql 'CREATE TABLE ' + table
  database = alasql.databases[settings.DATABASE]
  if settings.MAX_SQL_CACHE_SIZE
    alasql.MAXSQLCACHESIZE = settings.MAX_SQL_CACHE_SIZE
  if settings.AWS_OK or settings.LOCAL_STORAGE
    storage.get settings.DATABASE + ':database', (e, o) ->
      if not e and o
        restoreDatabase o, ->
          inflate null, ->
            deleteKeys ->
              saveDatabase ->
                console.log "ndxdb v#{version} ready"
                syncCallback 'ready', database
      else
        return upgradeDatabase()
  else
    maintenanceMode = false
    setImmediate ->
      console.log "ndxdb v#{version} ready"
      syncCallback 'ready', database
upgradeDatabase = ->
  storage.getOld settings.DATABASE + ':database', (e, o) ->
    if not e and o
      console.log 'upgrading database'
      restoreDatabase o, ->
        inflate null, ->
          deleteKeys ->
            saveDatabase ->
              console.log "ndxdb v#{version} ready"
              syncCallback 'ready', database
        , storage.getOld
    else
      console.log 'building new database'
      inflate null, ->
        deleteKeys ->
          saveDatabase ->
            console.log "ndxdb v#{version} ready"
            syncCallback 'ready', database
restoreFromBackup = (readStream) ->
  maintenanceMode = true
  storage.get '', (e, o) ->
    if not e and o
      restoreDatabase o, ->
        deleteKeys ->
          saveDatabase ->
            console.log "backup restored"
            syncCallback 'restore', null
  , readStream
exec = (sql, props, notCritical, isServer, cb) ->
  if maintenanceMode
    cb? []
    return []
  hash = (str) ->
    h = 5381
    i = str.length
    while i
      h = (h * 33) ^ str.charCodeAt --i
    h
  hh = hash sql
  ast = sqlCache[hh]
  if not ast
    ast = alasql.parse sql
  if not (ast.statements and ast.statements.length)
    cb? []
    return []
  else
    if sqlCacheSize > database.MAX_SQL_CACHE_SIZE
      resetSqlCache()
    sqlCacheSize++
    sqlCache[hh] = ast
  args = [].slice.call arguments
  args.splice 0, 3
  error = ''
  for statement in ast.statements
    table = ''
    isUpdate = statement instanceof alasql.yy.Update
    isInsert = statement instanceof alasql.yy.Insert
    isDelete = statement instanceof alasql.yy.Delete
    isSelect = statement instanceof alasql.yy.Select
    if statement.into
      table = statement.into.tableid
      isInsert = true
      isSelect = false
    else if statement.table then table = statement.table.tableid
    else if statement.from and statement.from.lenth then table = statement.from[0].tableid
    if settings.AUTO_ID and isInsert
      if Object.prototype.toString.call(props[0]) is '[object Array]'
        for prop in props[0]
          if not prop[settings.AUTO_ID]
            prop[settings.AUTO_ID] = ObjectID.generate()
      else
        if not props[0][settings.AUTO_ID]
          props[0][settings.AUTO_ID] = ObjectID.generate()
    updateIds = []
    if isUpdate
      idWhere = ''
      idProps = []
      if statement.where
        idWhere = ' WHERE ' + statement.where.toString().replace /\$(\d+)/g, (all, p) ->
          if props.length > +p
            idProps.push props[+p]
          '?'
      updateIds = database.exec 'SELECT *, \'' + table + '\' as ndxtable FROM ' + table + idWhere, idProps
    else if isDelete
      idWhere = ''
      if statement.where
        idWhere = ' WHERE ' + statement.where.toString().replace /\$(\d+)/g, '?'
      res = database.exec 'SELECT * FROM ' + table + idWhere, props
      if res and res.length
        async.each res, (r, callback) ->
          delObj =
            '__!deleteMe!': true
          delObj[getIdField(r)] = getId r
          storage.put settings.DATABASE + ':node:' + table + '/' + getId(r), delObj, null, notCritical
          asyncCallback (if isServer then 'serverDelete' else 'delete'), 
            id: getId r
            table: table
            obj: delObj
            isServer: isServer
          callback()
    else if isInsert
      if Object.prototype.toString.call(props[0]) is '[object Array]'
        for prop in props[0]
          if settings.AUTO_DATE
            prop.u = new Date().valueOf()
          storage.put settings.DATABASE + ':node:' + table + '/' + getId(prop), prop, null, notCritical
          asyncCallback (if isServer then 'serverInsert' else 'insert'), 
            id: getId prop
            table: table
            obj: prop
            args: args
            isServer: isServer
      else
        if settings.AUTO_DATE
          props[0].u = new Date().valueOf();
        storage.put settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0], null, notCritical
        asyncCallback (if isServer then 'serverInsert' else 'insert'),
          id: getId props[0]
          table: table
          obj: props[0]
          args: args
          isServer: isServer
  output = database.exec sql, props, cb   
  if updateIds and updateIds.length
    async.each updateIds, (updateId, callback) ->
      if settings.AUTO_DATE
        database.exec 'UPDATE ' + updateId.ndxtable + ' SET u=? WHERE ' + getIdField(updateId) + '=?', [new Date().valueOf(), getId(updateId)]
      res = database.exec 'SELECT * FROM ' + updateId.ndxtable + ' WHERE ' + getIdField(updateId) + '=?', [getId(updateId)]
      if res and res.length
        r = res[0]
        storage.put settings.DATABASE + ':node:' + updateId.ndxtable + '/' + getId(r), r, null, notCritical
        asyncCallback (if isServer then 'serverUpdate' else 'update'),
          id: getId r
          table: updateId.ndxtable
          obj: r
          args: args
          isServer: isServer
      callback()
  if error
    output.error = error
  output
makeWhere = (whereObj) ->
  if not whereObj or whereObj.sort or whereObj.sortDir or whereObj.pageSize
    return sql: ''
  sql = ''
  props = []
  parent = ''

  parse = (obj, op, comp) ->
    sql = ''
    for key of obj
      if key is '$or'
        sql += " #{op} (#{parse(obj[key], 'OR', comp)})".replace /\( OR /g, '('
      else if key is '$gt'
        sql += parse obj[key], op, '>'
      else if key is '$lt'
        sql += parse obj[key], op, '<'
      else if key is '$gte'
        sql += parse obj[key], op, '>='
      else if key is '$lte'
        sql += parse obj[key], op, '<='
      else if key is '$like'
        sql += " #{op} #{parent.replace('->', '')} LIKE '%#{obj[key]}%'"
        parent = ''
      else if Object::toString.call(obj[key]) == '[object Object]'
        parent += key + '->'
        sql += parse(obj[key], op, comp)
      else
        sql += " #{op} #{parent}#{key} #{comp} ?"
        props.push obj[key]
        parent = ''
    sql

  sql = parse(whereObj, 'AND', '=').replace(/(^|\() (AND|OR) /g, '$1')
  {
    sql: sql
    props: props
  }
select = (table, args, cb, isServer) ->
  ((user) ->
    asyncCallback (if isServer then 'serverPreSelect' else 'preSelect'), 
      table: table
      args: args
      user: user
    , (result) ->
      if not result
        return cb? [], 0
      args = args or {}
      where = makeWhere if args.where then args.where else args
      sorting = ''
      if args.sort
        sorting += " ORDER BY #{args.sort}"
        if args.sortDir
          sorting += " #{args.sortDir}"
      if where.sql
        where.sql = " WHERE #{where.sql}"
      myCb = (output) ->
        asyncCallback (if isServer then 'serverSelect' else 'select'), 
          table: table
          objs: output
          isServer: isServer
          user: user
        , ->
          total = output.length
          if args.page or args.pageSize
            args.page = args.page or 1
            args.pageSize = args.pageSize or 10
            output = output.splice (args.page - 1) * args.pageSize, args.pageSize
          cb? output, total
      output = exec "SELECT * FROM #{table}#{where.sql}#{sorting}", where.props, null, isServer,  myCb
  )(ndx.user)
count = (table, whereObj, cb, isServer) ->
  where = makeWhere whereObj
  if where.sql
    where.sql = " WHERE #{where.sql}"
  res = exec "SELECT COUNT(*) AS c FROM #{table}#{where.sql}", where.props, null, isServer, cb
  if res and res.length
    return res[0].c
  0
cleanObj = (obj) ->
  for key of obj
    if key.indexOf('$') is 0
      delete obj[key]
  return
update = (table, obj, whereObj, cb, isServer) ->
  cleanObj obj
  ((user) ->
    asyncCallback (if isServer then 'serverPreUpdate' else 'preUpdate'),
      id: getId obj
      table: table
      obj: obj
      where: whereObj
      user: user
    , (result) ->
      if not result
        return cb? []
      updateSql = []
      updateProps = []
      where = makeWhere whereObj
      if where.sql
        where.sql = " WHERE #{where.sql}"
      for key of obj
        if where.props.indexOf(obj[key]) is -1
          updateSql.push " `#{key}`=? "
          updateProps.push obj[key]
      props = updateProps.concat where.props
      exec "UPDATE #{table} SET #{updateSql.join(',')}#{where.sql}", props, null, isServer, cb
  )(ndx.user)
insert = (table, obj, cb, isServer) ->
  cleanObj obj
  ((user) ->
    asyncCallback (if isServer then 'serverPreInsert' else 'preInsert'),
      table: table
      obj: obj
      user: user
    , (result) ->
      if not result
        return cb? []
      if Object.prototype.toString.call(obj) is '[object Array]'
        exec "INSERT INTO #{table} SELECT * FROM ?", [obj], null, isServer, cb
      else
        exec "INSERT INTO #{table} VALUES ?", [obj], null, isServer, cb
  )(ndx.user)
upsert = (table, obj, whereObj, cb, isServer) ->
  where = makeWhere whereObj
  if where.sql
    where.sql = " WHERE #{where.sql}"
  test = exec "SELECT * FROM #{table}#{where.sql}", where.props, null, isServer
  if test and test.length and where.sql
    update table, obj, whereObj, cb, isServer
  else
    insert table, obj, cb, isServer
del = (table, whereObj, cb, isServer) ->
  where = makeWhere whereObj
  if where.sql
    where.sql = " WHERE #{where.sql}"
  ((user) ->
    asyncCallback (if isServer then 'serverPreDelete' else 'preDelete'),
      table: table
      where: whereObj
      user: user
    , (result) ->
      if not result
        cb? []
      exec "DELETE FROM #{table}#{where.sql}", where.props, null, isServer, cb
  )(ndx.user)  

module.exports =
  config: (config) ->
    for key of config
      keyU = underscored(key).toUpperCase()
      settings[keyU] = config[key] or config[keyU] or settings[keyU]
    settings.AWS_BUCKET = settings.AWS_BUCKET or process.env.AWS_BUCKET
    settings.AWS_ID = settings.AWS_ID or process.env.AWS_ID
    settings.AWS_KEY = settings.AWS_KEY or process.env.AWS_KEY
    settings.AWS_OK = settings.AWS_BUCKET and settings.AWS_ID and settings.AWS_KEY
    settings.MAX_SQL_CACHE_SIZE = settings.MAX_SQL_CACHE_SIZE or process.env.MAX_SQL_CACHE_SIZE or 100
    settings.ENCRYPTION_KEY = settings.ENCRYPTION_KEY or process.env.ENCRYPTION_KEY
    settings.DO_NOT_ENCRYPT = settings.DO_NOT_ENCRYPT or process.env.DO_NOT_ENCRYPT
    storage = require('./storage')()
    storage.checkDataDir()
    @
  start: ->
    attachDatabase()
    @
  on: (name, callback) ->
    callbacks[name].push callback
    @
  off: (name, callback) ->
    callbacks[name].splice callbacks[name].indexOf(callback), 1
    @
  serverExec: (type, args) ->
    if maintenanceMode
      return []
    idField = getIdField args.obj
    if type is 'update'
      database.exec 'DELETE FROM ' + args.table + ' WHERE ' + idField + '=?', [args.id]
      database.exec 'INSERT INTO ' + args.table + ' VALUES ?', [args.obj]
      storage.put settings.DATABASE + ':node:' + args.table + '/' + args.id, args.obj, null, true
    else if type is 'insert'
      database.exec 'INSERT INTO ' + args.table + ' VALUES ?', [args.obj]
      storage.put settings.DATABASE + ':node:' + args.table + '/' + args.id, args.obj, null, true
    else if type is 'delete'
      database.exec 'DELETE FROM ' + args.table + ' WHERE ' + idField + '=?', [args.id]
      delObj =
        '__!deleteMe!': true
      delObj[idField] = args.id
      storage.put settings.DATABASE + ':node:' + args.table + '/' + args.id, args.obj, null, true
    asyncCallback type, args
  exec: exec
  select: select
  count: count
  update: update
  insert: insert
  upsert: upsert
  delete: del
    
  maintenanceOn: ->
    maintenanceMode = true
  maintenanceOff: ->
    maintenanceMode = false
  version: ->
    version
  maintenance: ->
    maintenanceMode
  getDb: ->
    database.tables
  cacheSize: ->
    database.sqlCacheSize
  saveDatabase: saveDatabase
  restoreFromBackup: restoreFromBackup
  consolidate: ->
    deleteKeys ->
      saveDatabase()
  uploadDatabase: (cb) ->
    deleteKeys ->
      storage.put settings.DATABASE + ':database', database.tables, (e) ->
        if not e
          console.log 'database uploaded'
        cb?()
  resetSqlCache: ->
    database.resetSqlCache()
  setNdx: (_ndx) ->
    ndx = _ndx
    @
  alasql: alasql