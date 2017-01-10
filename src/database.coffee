'use strict'

alasql = require 'alasql'
async = require 'async'
ObjectID = require 'bson-objectid'
settings = require './settings'

module.exports = (config) ->
  settings.LOCAL_STORAGE = config.localStorage or config.local or settings.LOCAL_STORAGE
  settings.PREFER_LOCAL = config.preferLocal or settings.PREFER_LOCAL
  settings.DATABASE = config.database or config.dbname or config.databaseName or settings.DATABASE
  settings.AUTO_ID = config.autoId or settings.AUTO_ID
  settings.AWS_BUCKET = config.awsBucket or settings.AWS_BUCKET
  settings.AWS_REGION = config.awsRegion or settings.AWS_REGION
  settings.AWS_ID = config.awsId or settings.AWS_ID
  settings.AWS_KEY = config.awsKey or settings.AWS_KEY
  settings.AWS_OK = settings.AWS_BUCKET and settings.AWS_ID and settings.AWS_KEY
  storage = require('./storage')()
  database = null
  maintenanceMode = false
  getId = (row) ->
    row[settings.autoId] or row.id or row._id or row.i
  getIdField = (row) ->
    output = '_id'
    if row[settings.autoId] then output = settings.autoId
    else if row.id then output = 'id'
    else if row._id then output = '_id'
    else if row.i then output = 'i'
    output
  safeCallback = (callbackName, obj) ->
    if config.callbacks and config.callbacks[callbackName]
      config.callbacks[callbackName] obj
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
          for key of o
            if database.tables[key]
              database.tables[key].data = o[key].data
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
  attachDatabase()
  exec: (sql, props, notCritical) ->
    if maintenanceMode
      return []
    if settings.autoId and /INSERT/i.test(sql)
      if Object.prototype.toString.call(props[0]) is '[object Array]'
        for prop in props[0]
          prop[settings.autoId] = ObjectID.generate()
      else
        props[0][settings.autoId] = ObjectID.generate()
    updateIds = []
    updateTable = ''

    if /UPDATE/i.test(sql)
      upReg = /UPDATE\s+(.+)\s+SET\s+([^\s]+)/i
      if /WHERE/i.test(sql)
        upReg = /UPDATE\s+(.+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i
      sql.replace upReg, (all, table, set, where) ->
        updateTable = table
        noSetFields = (set.match(/\?/g) or []).length
        pCopy = JSON.parse JSON.stringify props
        pCopy.splice 0, noSetFields
        if where
          updateIds = database.exec 'SELECT * FROM ' + table + ' WHERE ' + where, pCopy
        else
          updateIds = database.exec 'SELECT * FROM ' + table
    else if /DELETE/i.test(sql)
      delReg = /DELETE\s+FROM\s+([^\s]+)/i
      if /WHERE/i.test(sql)
        delReg = /DELETE\s+FROM\s+(.+)\s+WHERE\s+(.+)/i
      sql.replace delReg, (all, table, where) ->
        if where
          res = database.exec 'SELECT * FROM ' + table + ' WHERE ' + where, props
        else
          res = database.exec 'SELECT * FROM ' + table
        if res and res.length
          async.each res, (r, callback) ->
            delObj =
              '__!deleteMe!': true
            delObj[settings.autoId or '_id'] = getId r
            if not notCritical
              storage.put settings.DATABASE + ':node:' + table + '/' + getId(r), delObj
            safeCallback 'delete', 
              id: getId r
              table: table
              obj: delObj
            callback()
    else if /INSERT/i.test(sql)
      sql.replace /INSERT\s+INTO\s+(.+)\s+(SELECT|VALUES)/i, (all, table) ->
        if Object.prototype.toString.call(props[0]) is '[object Array]'
          for prop in props[0]
            if not notCritical
              storage.put settings.DATABASE + ':node:' + table + '/' + getId(prop), prop
            safeCallback 'insert', 
              id: getId prop
              table: table
              obj: prop
        else
          if not notCritical
            storage.put settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0]
          safeCallback 'insert',
            id: getId props[0]
            table: table
            obj: props[0]
    output = database.exec sql, props
    if updateIds and updateIds.length
      async.each updateIds, (updateId, callback) ->
        res = database.exec 'SELECT * FROM ' + updateTable + ' WHERE ' + getIdField(updateId) + '=?', [getId(updateId)]
        if res and res.length
          r = res[0]
          if not notCritical
            storage.put settings.DATABASE + ':node:' + updateTable + '/' + getId(r), r
          safeCallback 'update',
            id: getId r
            table: updateTable
            obj: r
        callback()
    output
  maintenanceOn: ->
    maintenanceMode = true
  maintenanceOff: ->
    maintenanceMode = false
  maintenance: ->
    maintenanceMode
  getDb: ->
    database
  uploadDatabase: (cb) ->
    storage.put settings.DATABASE + ':database', database.tables, (e) ->
      if not e
        console.log 'database uploaded'
      cb?()