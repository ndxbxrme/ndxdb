'use strict'

alasql = require 'alasql'
async = require 'async'
ObjectID = require 'bson-objectid'

module.exports = (config) ->
  dbname = config.database or config.dbname or config.databaseName
  s3 = require('./s3')(config)
  database = null
  maintenanceMode = false
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
                idField = if config.autoId then config.autoId else if o._id then '_id' else if o.id then 'id' else 'i'
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
    if notCritical or not config.awsBucket or not config.awsId or not config.awsKey
      #do nothing
    else
      if sql.indexOf('UPDATE') isnt -1
        sql.replace /UPDATE\s+(.+)\s+SET\s+(.+)\s+WHERE\s+(.+)/i, (all, table, set, where) ->
          noSetFields = (set.match(/\?/g) or []).length
          props.splice noSetFields
          res = database.exec 'SELECT * FROM ' + table + ' WHERE ' + where, props
          if res and res.length
            async.each res, (r, callback) ->
              s3.put dbname + ':node:' + table + '/' + (r[config.autoId] or r.id or r._id or r.i), r
              callback()
      else if sql.indexOf('DELETE') isnt -1
        sql.replace /DELETE\s+FROM\s+(.+)\s+WHERE\s+(.+)/i, (all, table, where) ->
          res = database.exec 'SELECT * FROM ' + table + ' WHERE ' + where, props
          if res and res.length
            async.each res, (r, callback) ->
              delObj =
                '__!deleteMe!': true
              delObj[config.autoId or '_id'] = r[config.autoId] or r.id or r._id or r.i
              s3.put dbname + ':node:' + table + '/' + (r[config.autoId] or r.id or r._id or r.i), delObj
              callback()
      else if sql.indexOf('INSERT') isnt -1
        sql.replace /INSERT\s+INTO\s+(.+)\s+(SELECT|VALUES)/i, (all, table) ->
          if Object.prototype.toString.call(props[0]) is '[object Array]'
            for prop in props[0]
              s3.put dbname + ':node:' + table + '/' + (prop[config.autoId] or prop.id or prop._id or prop.i), prop
          else
            s3.put dbname + ':node:' + table + '/' + (props[0][config.autoId] or props[0].id or props[0]._id or props[0].i), props[0]
    database.exec sql, props
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