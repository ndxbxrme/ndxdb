db = require '../database.js'
.config
  database: 'db'
  tables: ['users', 'properties', 'progressions', 'emailtemplates', 'smstemplates', 'dashboard']
  autoId: '_id'
  localStorage: './data'
  doNotEncrypt: true
.on 'ready', ->
  vals = [
    {
      country: 'China'
      population: 1371220000
    }
    {
      country: 'India'
      population: 1311050000
    }
    {
      country: 'United States'
      population: 321418000
    }
  ]
  db.insert 'users', vals
  result = db.exec 'SELECT * FROM users WHERE population > ? ORDER BY population ASC', [500000000]
  console.log 'result', result
  ###
  result = db.exec 'SELECT * FROM users'
  console.log 'result', result
  ###
.start()