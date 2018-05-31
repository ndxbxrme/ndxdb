'use strict'

fs = require 'fs'
alasql = require 'alasql'
require('./alasql-patch') alasql
async = require 'async'
ObjectID = require 'bson-objectid'
objtrans = require 'objtrans'
settings = require './settings'
storage = null
s = require('underscore.string')
DeepDiff = require 'deep-diff'
.diff
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
  selectTransform: []
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
  if callbacks[name] and callbacks[name].length
    for callback in callbacks[name]
      callback obj
  cb?()
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
  console.log 'DELETE KEYS'
  storage.keys null, settings.DATABASE + ':node:', (e, r) ->
    if not e and r and r.Contents
      for key in r.Contents
        console.log 'deleting', key.Key
        storage.del key.Key
    if r.IsTruncated
      process.nextTick ->
        deleteKeys cb
    else
      cb()
readDiffs = (from, to, out) ->
  diffs = DeepDiff from, to
  out = out or {}
  if diffs
    for dif in diffs
      switch dif.kind
        when 'E', 'N'
          myout = out
          mypath = dif.path.join('.')
          good = true
          if dif.lhs and dif.rhs and typeof(dif.lhs) isnt typeof(dif.rhs)
            if dif.lhs.toString() is dif.rhs.toString()
              good = false
          if good
            myout[mypath] ={}
            myout = myout[mypath]
            myout.from = dif.lhs
            myout.to = dif.rhs
  out
inflate = (from, cb, getFn) ->
  if not getFn
    getFn = storage.get
  storage.keys from, settings.DATABASE + ':node:', (e, r) ->
    if e or not r.Contents
      return console.log 'error', e
    async.eachSeries r.Contents, (key, callback) ->
      key.Key.replace /(.+):(.+):(.+)\/(.+)(:.+)*/, (all, db, type, table, id, randId) ->
        console.log 'key', db, type, table, id
        if db and table and id and db.substr(db.lastIndexOf('/') + 1) is settings.DATABASE
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
    else if e is 'ENOENT'
      console.log 'building new database'
      inflate null, ->
        deleteKeys ->
          saveDatabase ->
            console.log "ndxdb v#{version} ready"
            syncCallback 'ready', database
    else
      console.log '\nerror decrypting database.  \nif you have changed the encryption key and want to save your data use ndx-framework to upgrade the database otherwise delete the data directory and restart the app'
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
exec = (sql, props, notCritical, isServer, cb, changes) ->
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
            user: ndx.user
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
            user: ndx.user
            isServer: isServer
      else
        if settings.AUTO_DATE
          props[0].u = new Date().valueOf();
        storage.put settings.DATABASE + ':node:' + table + '/' + getId(props[0]), props[0], null, notCritical
        asyncCallback (if isServer then 'serverInsert' else 'insert'),
          id: getId props[0]
          table: table
          obj: props[0]
          user: ndx.user
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
          changes: changes
          user: ndx.user
          isServer: isServer
      callback()
  if error
    output.error = error
  output
maxModified = (table, cb) ->
  database.exec 'SELECT MAX(modifiedAt) as maxModified FROM ' + table, null, (result) ->
    maxModified = 0
    if result and result.length
      maxModified = result[0].maxModified or 0
    cb? maxModified
makeWhere = (whereObj) ->
  if not whereObj or whereObj.sort or whereObj.sortDir or whereObj.pageSize
    return sql: ''
  props = []
  parent = ''

  parse = (obj, op, comp) ->
    sql = ''
    writeVal = (key, comp) ->
      fullKey = "#{parent}`#{key}`".replace /\./g, '->'
      fullKey = fullKey.replace /->`\$[a-z]+`$/, ''
      if obj[key] is null
        if key is '$ne' or key is '$neq'
          sql += " #{op} #{fullKey} IS NOT NULL"
        else
          sql += " #{op} #{fullKey} IS NULL"
      else
        sql += " #{op} #{fullKey} #{comp} ?"
        props.push obj[key]
    for key of obj
      if obj.hasOwnProperty key
        if key is '$or'
          orsql = ''
          for thing in obj[key]
            objsql = parse(thing, 'AND', comp).replace /^ AND /, ''
            if / AND | OR /.test(objsql) and objsql.indexOf('(') isnt 0
              objsql = "(#{objsql})"
            orsql += ' OR ' + objsql
          sql += " #{op} (#{orsql})".replace /\( OR /g, '('
        else if key is '$and'
          andsql = ''
          for thing in obj[key]
            andsql += parse(thing, 'AND', comp)
          sql += " #{op} (#{andsql})".replace /\( AND /g, '('
        else if key is '$gt'
          writeVal key, '>'
        else if key is '$lt'
          writeVal key, '<'
        else if key is '$gte'
          writeVal key, '>='
        else if key is '$lte'
          writeVal key, '<='
        else if key is '$eq'
          writeVal key, '='
        else if key is '$neq'
          writeVal key, '!='
        else if key is '$ne'
          writeVal key, '!='
        else if key is '$in'
           writeVal key, 'IN'
        else if key is '$nin'
           writeVal key, 'NOT IN'
        else if key is '$like'
          sql += " #{op} #{parent.replace(/->$/, '')} LIKE '%#{obj[key]}%'"
          parent = ''
        else if key is '$null'
          sql += " #{op} #{parent.replace(/->$/, '')} IS NULL"
          parent = ''
        else if key is '$nnull'
          sql += " #{op} #{parent.replace(/->$/, '')} IS NOT NULL"
          parent = ''
        else if key is '$nn'
          sql += " #{op} #{parent.replace(/->$/, '')} IS NOT NULL"
          parent = ''
        else if Object::toString.call(obj[key]) is '[object Object]'
          parent += '`' + key + '`->'
          sql += parse(obj[key], op, comp)
        else
          writeVal key, comp
    parent = ''
    sql
  delete whereObj['#']
  sql = parse(whereObj, 'AND', '=').replace(/(^|\() (AND|OR) /g, '$1')
  {
    sql: sql
    props: props
  }
select = (table, args, cb, isServer) ->
  new Promise (resolve, reject) ->
    ((user) ->
      asyncCallback (if isServer then 'serverPreSelect' else 'preSelect'), 
        table: table
        args: args
        user: user
      , (result) ->
        if not result
          resolve []
          return cb? [], 0
        args = args or {}
        where = makeWhere if args.where then args.where else args
        sorting = ''
        if args.sort
          if Object.prototype.toString.call(args.sort) is '[object Object]'
            sorting += ' ORDER BY '
            i = 0
            for key of args.sort
              if i++ > 0
                sorting += ', '
              bit = args.sort[key]
              mykey = key.replace /\./g, '->'
              if bit is 1 or bit is 'ASC'
                sorting += "`#{mykey}` ASC"
              else
                sorting += "`#{mykey}` DESC"
          else
            args.sort = args.sort.replace /\./g, '->'
            sorting += " ORDER BY `#{args.sort}`"
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
            asyncCallback (if isServer then 'serverSelectTransform' else 'selectTransform'),
              transformer: args.transformer
              table: table
              objs: output
              isServer: isServer
              user: user
            , ->
              ndx.user = user
              resolve output
              cb? output, total
        ndx.user = user
        output = exec "SELECT * FROM #{table}#{where.sql}#{sorting}", where.props, null, isServer,  myCb
    )(ndx.user)
selectOne = (table, args, cb, isServer) ->
  output = await select table, args, null, isServer
  if output and output.length
    return output[0]
  else
    return null
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
    if key.indexOf('$') is 0 or key is '#' or not obj.hasOwnProperty(key)
      delete obj[key]
  return
update = (table, obj, whereObj, cb, isServer) ->
  cleanObj obj
  where = makeWhere whereObj
  if where.sql
    where.sql = " WHERE #{where.sql}"
  ((user) ->
    exec "SELECT * FROM #{table}#{where.sql}", where.props, null, true, (oldItems) ->
      if oldItems
        async.each oldItems, (oldItem, diffCb) ->
          diffs = readDiffs oldItem, obj
          id = getId oldItem
          asyncCallback (if isServer then 'serverPreUpdate' else 'preUpdate'),
            id: id
            table: table
            obj: obj
            oldObj: oldItem
            where: whereObj
            changes: diffs
            user: user
          , (result) ->
            if not result
              return cb? []
            updateSql = []
            updateProps = []
            for key of obj
              if where.props.indexOf(obj[key]) is -1
                updateSql.push " `#{key}`=? "
                updateProps.push obj[key]
            updateProps.push id
            ndx.user = user
            exec "UPDATE #{table} SET #{updateSql.join(',')} WHERE `#{[settings.AUTO_ID]}`= ?", updateProps, null, isServer, diffCb, diffs
        , ->
          cb? []
      else
        cb? []
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
      ndx.user = user
      if Object.prototype.toString.call(obj) is '[object Array]'
        exec "INSERT INTO #{table} SELECT * FROM ?", [obj], null, isServer, cb
      else
        exec "INSERT INTO #{table} VALUES ?", [obj], null, isServer, cb
  )(ndx.user)
upsert = (table, obj, whereObj, cb, isServer) ->
  where = makeWhere whereObj
  if not whereObj and obj[settings.AUTO_ID]
    whereObj = {}
    whereObj[settings.AUTO_ID] = obj[settings.AUTO_ID]
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
      ndx.user = user
      exec "DELETE FROM #{table}#{where.sql}", where.props, null, isServer, cb
  )(ndx.user)  
consolidate = ->
  new Promise (resolve, reject) ->
    deleteKeys ->
      saveDatabase resolve
consolidateCheck = ->
  storage.keys null, settings.DATABASE + ':node:', (e, r) ->
    if r and r.Contents and r.Contents.length > (+settings.CONSOLIDATE_COUNT or 500)
      consolidate()


module.exports =
  config: (config) ->
    for key of config
      keyU = s(key).underscored().value().toUpperCase()
      settings[keyU] = config[key] or config[keyU] or settings[keyU]
    settings.AWS_BUCKET = settings.AWS_BUCKET or process.env.AWS_BUCKET
    settings.AWS_ID = settings.AWS_ID or process.env.AWS_ID
    settings.AWS_KEY = settings.AWS_KEY or process.env.AWS_KEY
    settings.AWS_OK = settings.AWS_BUCKET and settings.AWS_ID and settings.AWS_KEY
    settings.MAX_SQL_CACHE_SIZE = settings.MAX_SQL_CACHE_SIZE or process.env.MAX_SQL_CACHE_SIZE or 100
    settings.ENCRYPTION_KEY = settings.ENCRYPTION_KEY or process.env.ENCRYPTION_KEY
    settings.ENCRYPTION_ALGORITHM = settings.ENCRYPTION_ALGORITHM or process.env.ENCRYPTION_ALGORITHM
    settings.DO_NOT_ENCRYPT = settings.DO_NOT_ENCRYPT or process.env.DO_NOT_ENCRYPT
    if not settings.AUTO_ID
      settings.AUTO_ID = '_id'
    storage = require('./storage')()
    storage.checkDataDir()
    @
  start: ->
    attachDatabase()
    setInterval consolidateCheck, (+settings.CONSOLIDATE_MINS or 60) * 60 * 1000
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
  selectOne: selectOne
  count: count
  update: update
  insert: insert
  upsert: upsert
  delete: del
  bindFns: (user) ->
    #not currently used
  maxModified: maxModified
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
  consolidate: consolidate
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
  makeSlug: (table, template, data, cb) ->
    slug = s(ndx.fillTemplate(template, data)).prune(30, '').slugify().value()
    if data.slug and data.slug.indexOf(slug) is 0
      return cb true
    testSlug = slug
    outSlug = null
    async.whilst ->
      outSlug is null
    , (callback) =>
      @select table,
        slug: testSlug
      , (results) ->
        if results and results.length
          testSlug = slug + '-' + Math.floor(Math.random() * 9999)
        else
          outSlug = testSlug
        callback null, outSlug
      , true
    , (err, slug) ->
      data.slug = slug
      cb? true