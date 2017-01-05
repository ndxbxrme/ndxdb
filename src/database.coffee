'use strict'

alasql = require 'alasql'
async = require 'async'
ObjectID = require 'bson-objectid'

module.exports = (config) ->
  dbname = config.database or config.dbname or config.databaseName
  s3 = require('./s3')(config)
  database = null
  maintenanceMode = false
  getId = (row) ->
    row[config.autoId] or row.id or row._id or row.i
  getIdField = (row) ->
    output = '_id'
    if row[config.autoId] then output = config.autoId
    else if row.id then output = 'id'
    else if row._id then output = '_id'
    else if row.i then output = 'i'
    output
  attachDatabase = ->
    maintenanceMode = true
    alasql 'CREATE DATABASE ' + dbname
    alasql 'USE ' + dbname
    for table in config.tables
      alasql 'CREATE TABLE ' + table
    database = alasql.databases[dbname]
    deleteKeys = (cb) ->
      s3.keys null, dbname + ':node:', (e, r) ->
        if not e and r and r.Contents
          for key in r.Contents
            s3.del key.Key
        if r.IsTruncated
          deleteKeys cb
        else
          cb()
    inflate = (from, cb) ->
      s3.keys from, dbname + ':node:', (e, r) ->
        if e or not r.Contents
          return console.log 'error', e
        async.eachSeries r.Contents, (key, callback) ->
          key.Key.replace /(.+):(.+):(.+)\/(.+)/, (all, db, type, table, id) ->
            if db and table and id and db is dbname
              s3.get key.Key, (e, o) ->
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
    if config.awsBucket and config.awsId and config.awsKey
      s3.get dbname + ':database', (e, o) ->
        if not e and o
          for key of o
            if database.tables[key]
              database.tables[key].data = o[key].data
        inflate null, ->
          deleteKeys ->
            s3.put dbname + ':database', database.tables, (e) ->
              if not e
                console.log 'database updated and uploaded'
                maintenanceMode = false
      setInterval ->
        maintenanceMode = true
        s3.put dbname + ':database', database.tables, (e) ->
          if not e
            console.log 'database uploaded'
            deleteKeys ->
              maintenanceMode = false
          else
            maintenanceMode = false
      , 11 * 60 * 60 * 1000
  attachDatabase()
  exec: (sql, props, notCritical) ->
    if maintenanceMode
      return []
    if config.autoId and /INSERT/i.test(sql)
      if Object.prototype.toString.call(props[0]) is '[object Array]'
        for prop in props[0]
          prop[config.autoId] = ObjectID.generate()
      else
        props[0][config.autoId] = ObjectID.generate()
    updateIds = []
    updateTable = ''
    if notCritical or not config.awsBucket or not config.awsId or not config.awsKey
      #do nothing
    else
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
              delObj[config.autoId or '_id'] = getId r
              s3.put dbname + ':node:' + table + '/' + getId(r), delObj
              callback()
      else if /INSERT/i.test(sql)
        sql.replace /INSERT\s+INTO\s+(.+)\s+(SELECT|VALUES)/i, (all, table) ->
          if Object.prototype.toString.call(props[0]) is '[object Array]'
            for prop in props[0]
              s3.put dbname + ':node:' + table + '/' + getId(prop), prop
          else
            s3.put dbname + ':node:' + table + '/' + getId(props[0]), props[0]
    output = database.exec sql, props
    if updateIds and updateIds.length
      async.each updateIds, (updateId, callback) ->
        res = database.exec 'SELECT * FROM ' + updateTable + ' WHERE ' + getIdField(updateId) + '=?', [getId(updateId)]
        if res and res.length
          r = res[0]
          s3.put dbname + ':node:' + updateTable + '/' + getId(r), r
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
    s3.put dbname + ':database', database.tables, (e) ->
      if not e
        console.log 'database uploaded'
      cb?()