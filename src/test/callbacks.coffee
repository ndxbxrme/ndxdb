db = require '../database.js'
.config
  database: 'callbacks'
  tables: ['t1']
.on 'ready', ->
  db.on 'preSelect', (data, cb) ->
    console.log 'pre select'
    cb()
  db.on 'select', (data, cb) ->
    console.log 'select', data
    if data.table is 't1'
      console.log 'switchin stuff'
      #data.objs.splice 0, 1
      data.objs.push
        boom: 'baam'
    cb()
  db.on 'preUpdate', (data, cb) ->
    console.log 'pre update'
    cb()
  db.on 'update', (data, cb) ->
    console.log 'update'
    cb()
  db.on 'preInsert', (data, cb) ->
    console.log 'pre insert'
    cb()
  db.on 'insert', (data, cb) ->
    console.log 'insert'
    cb()
  db.on 'preDelete', (data, cb) ->
    console.log 'pre delete'
    cb()
  db.on 'delete', (data, cb) ->
    console.log 'delete'
    cb()
  db.insert 't1',
    my: 'thing'
  db.select 't1',
    page: 2
    pageSize: 1
  , (things, total) ->
    console.log things, total
.start()