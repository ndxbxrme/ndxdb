'use strict'

fs = require 'fs'
alasql = require 'alasql'
require('./alasql-patch') alasql
async = require 'async'
ObjectID = require 'bson-objectid'
settings = require './settings'
storage = require('./storage')()
database = null
sqlCache = {}
sqlCacheSize = 0
resetSqlCache = ->
  sqlCache = {}
  sqlCacheSize = 0
MAXSQLCACHESIZE = 1000
config = {}
maintenanceMode = false
callbacks =
  ready: []
  insert: []
  update: []
  delete: []
  restore: []
restoreDatabase = (data) ->
  for key of o
    if database.tables[key]
      database.exec 'DELETE FROM ' + key
      database.exec 'INSERT INTO ' + key + ' SELECT * FROM ?', [data[key].data]
  safeCallback 'restore', database
getId = (row) ->
  row[settings.AUTO_ID] or row.id or row._id or row.i
getIdField = (row) ->
  output = '_id'
  if row[settings.AUTO_ID] then output = settings.AUTO_ID
  else if row.id then output = 'id'
  else if row._id then output = '_id'
  else if row.i then output = 'i'
  output
safeCallback = (name, obj) ->
  for cb in callbacks[name]
    cb obj
attachDatabase = ->
  maintenanceMode = true
  alasql 'CREATE DATABASE ' + settings.DATABASE
  alasql 'USE ' + settings.DATABASE
  for table in config.tables
    alasql 'CREATE TABLE ' + table
  database = alasql.databases[settings.DATABASE]
  deleteKeys = (cb) ->
    storage.keys null, settings.DATABASE + ':node:', (e, r) ->
      if not e and r and r.Contents
        for key in r.Contents
          storage.del key.Key
      if r.IsTruncated
        deleteKeys cb
      else
        cb()
  inflate = (from, cb) ->
    storage.keys from, settings.DATABASE + ':node:', (e, r) ->
      if e or not r.Contents
        return console.log 'error', e
      async.eachSeries r.Contents, (key, callback) ->
        key.Key.replace /(.+):(.+):(.+)\/(.+)/, (all, db, type, table, id) ->
          if db and table and id and db is settings.DATABASE
            storage.get key.Key, (e, o) ->
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
          cb()
  if settings.AWS_OK or settings.LOCAL_STORAGE
    storage.get settings.DATABASE + ':database', (e, o) ->
      if not e and o
        restoreDatabase o
      inflate null, ->
        deleteKeys ->
          storage.put settings.DATABASE + ':database', database.tables, (e) ->
            if not e
              console.log 'database updated and uploaded'
            maintenanceMode = false
            safeCallback 'ready', database
    ###
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
    ###
  else
    maintenanceMode = false
    safeCallback 'ready', database
module.exports =
  config: (_config) ->
    config = _config
    settings.LOCAL_STORAGE = config.localStorage or config.local or settings.LOCAL_STORAGE
    settings.PREFER_LOCAL = config.preferLocal or settings.PREFER_LOCAL
    settings.DATABASE = config.database or config.dbname or config.databaseName or settings.DATABASE
    settings.AUTO_ID = config.autoId or settings.AUTO_ID
    settings.AUTO_DATE = config.autoDate or settings.AUTO_DATE
    settings.AWS_BUCKET = config.awsBucket or settings.AWS_BUCKET
    settings.AWS_REGION = config.awsRegion or settings.AWS_REGION
    settings.AWS_ID = config.awsId or settings.AWS_ID
    settings.AWS_KEY = config.awsKey or settings.AWS_KEY
    settings.AWS_OK = settings.AWS_BUCKET and settings.AWS_ID and settings.AWS_KEY
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
    safeCallback type, args
  exec: (sql, props, notCritical) ->
    if maintenanceMode
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
      return []
    else
      if sqlCacheSize > MAXSQLCACHESIZE
        resetSqlCache()
      sqlCacheSize++
      sqlCache[hh] = ast
    args = [].slice.call arguments
    args.splice 0, 3
    error = ''
    for statement in ast.statements
      table = ''
      if statement.into then table = statement.into.tableid
      else if statement.table then table = statement.table.tableid
      else if statement.from and statement.from.lenth then table = statement.from[0].tableid
      isUpdate = statement instanceof alasql.yy.Update
      isInsert = statement instanceof alasql.yy.Insert
      isDelete = statement instanceof alasql.yy.Delete
      isSelect = statement instanceof alasql.yy.Select
      
      if settings.AUTO_ID and isInsert
        if Object.prototype.toString.call(props[0]) is '[object Array]'
          for prop in props[0]
            prop[settings.AUTO_ID] = ObjectID.generate()
        else
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
            safeCallback 'delete', 
              id: getId r
              table: table
              obj: delObj
            callback()
      else if isInsert
        if Object.prototype.toString.call(props[0]) is '[object Array]'
          for prop in props[0]
            if settings.AUTO_DATE
              prop.u = new Date().valueOf()
            storage.put settings.DATABASE + ':node:' + table + '/' + getId(prop), prop, null, notCritical
            safeCallback 'insert', 
              id: getId prop
              table: table
              obj: prop
              args: args
        else
          if settings.AUTO_DATE
            props[0].u = new Date().valueOf();
          storage.put settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0], null, notCritical
          safeCallback 'insert',
            id: getId props[0]
            table: table
            obj: props[0]
            args: args
    output = database.exec sql, props    
    if updateIds and updateIds.length
      async.each updateIds, (updateId, callback) ->
        if settings.AUTO_DATE
          database.exec 'UPDATE ' + updateId.ndxtable + ' SET u=? WHERE ' + getIdField(updateId) + '=?', [new Date().valueOf(), getId(updateId)]
        res = database.exec 'SELECT * FROM ' + updateId.ndxtable + ' WHERE ' + getIdField(updateId) + '=?', [getId(updateId)]
        if res and res.length
          r = res[0]
          storage.put settings.DATABASE + ':node:' + updateId.ndxtable + '/' + getId(r), r, null, notCritical
          safeCallback 'update',
            id: getId r
            table: updateId.ndxtable
            obj: r
            args: args
        callback()
    if error
      output.error = error
    output
  maintenanceOn: ->
    maintenanceMode = true
  maintenanceOff: ->
    maintenanceMode = false
  maintenance: ->
    maintenanceMode
  getDb: ->
    database.tables
  restoreFromBackup: (data) ->
    if data
      restoreDatabase data
  uploadDatabase: (cb) ->
    storage.put settings.DATABASE + ':database', database.tables, (e) ->
      if not e
        console.log 'database uploaded'
      cb?()
  alasql: alasql