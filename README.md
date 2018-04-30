# ndxdb
* a cheap and easy in-memory sql database for nodejs projects that persits to S3 
* built on top of the mighty [alasql](https://github.com/agershun/alasql)
* useful for hobby projects on free servers (heroku) where you don't want the hassle of a database server and don't have reliable on-server file storage 
* every row in the database must have an id field (named id, _id or i).  id's can be generated automatically by using the `autoId` setting
#### `from v1.7 onward all data is encrypted by default.  if you are upgrading to v1.7 your data will get upgraded automatically but you should make a backup first.
```
  db.select('tableName', {
    where: {
      email: {
        $like: 'something'
      }
    },
    page: 1
    pageSize: 10
    sort: 'email'
    sortDir: 'ASC'
  }, function(results, total) {
    //do something with your data
  });
  
  db.select('tableName', {
    email: {
      $like: 'something'
    }
  }, function(results, total) {
    //do something with your data
  });
  
  db.insert('tableName', objectToInsert, callbackFn);
  
  db.update('tableName', updateObject, whereObject, callbackFn);
  
  db.upsert('tableName', objectToUpsert, whereObject, callbackFn);
  
  db.delete('tableName', whereObject, callbackFn);
  
  // examples of good inserts etc
  db.exec('INSERT INTO table1 VALUES ?', [obj]);
  db.exec('INSERT INTO table1 SELECT * FROM ?', [[obj1, obj2, obj3]]);
  db.exec('UPDATE table1 SET country=? WHERE country=?', ['Republic of China', 'China']);
  db.exec('DELETE FROM table1 WHERE population > ?', [500000000]);
```
## Usage
`npm install --save ndxdb`
```javascript
var db = require('ndxdb')
.config({
  database: 'mydb', //database name - required
  tables: ['table1', 'table2'], //database tables - required
  awsBucket: process.env.AWS_BUCKET, //aws info
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsId: process.env.AWS_ID,
  awsKey: process.env.AWS_KEY,
  localStorage: 'data', //you can persist data to a local directory too
  autoId: '_id', //generate id's automatically
  encryptionKey: 'something random', //all data is encrypted by default
  doNotEncrypt: true //turns off database encryption
})
.on('ready', function() { //database has been built/rebuilt and is ready to go
  test();
}) //there are also callbacks for insert, update and delete
.start(); // call start() to get things going

var test = function() {
  var vals = [
    {
      country: 'China'
      population: 1371220000
    },{
      country: 'India'
      population: 1311050000
    },{
      country: 'United States'
      population: 321418000
    }
  ];
  db.insert('table1', vals);
  db.select('table1', {
    where: {
      population: {
        $gt: 500000000
      }
    },
    sort: 'population',
    sortDir: 'ASC'
  }, function(results, total) {
    /*
    result = [
      {
        country: 'India'
        population: 1311050000
      },{
        country: 'China'
        population: 1371220000
      }
    ],
    total = 2
    */
  });
}
```
if you don't set your AWS info or a local storage directory then the database will work as an in-memory database with no persistence

## Environment Variables
most of the database configuration can be set as environment variables instead 
* LOCAL_STORAGE
* DATABASE
* AUTO_ID
* AUTO_DATE
* AWS_BUCKET
* AWS_REGION
* AWS_ID
* AWS_KEY  
* ENCRYPTION_KEY
* DO_NOT_ENCRYPT  

in which case you can simplify your code 
```javascript
var db = require('ndxdb')
.config({
  tables: ['table1', 'table2']
})
.start();
```

### Methods
<a name="methods"></a>
#### `db.config(object args) -> db`

Configure the database

#### `db.start() -> db`

Start the database

## Callbacks

```coffeescript
ndx.database.on 'callbackName', (args, cb) ->
  #do something with args
  cb true #or false if you want to cancel the operation
```

### `ready`
  The database is ready to use

### `preInsert`
* `args.table`
  The database table being operated on
* `args.obj`
  The object being inserted into the database
* `args.user`
  The user carrying out the operation
  
`cb(false)` to cancel the insert
  
### `insert`
* `args.id`
  The inserted object's id
* `args.table`
  The database table being operated on
* `args.obj`
  The object that was inserted into the database
* `args.user`
  The user carrying out the operation
  
### `preUpdate`
* `args.id`
  The id of the object being updated
* `args.table`
  The database table being operated on
* `args.where`
  The database query
* `args.obj`
  The data to update
* `args.oldObj`
  The value of the object preUpdate
* `args.changes`
  The changes to be applied
* `args.user`
  The user carrying out the operation
  
`cb(false)` to cancel the update
  
### `update`
* `args.id`
  The id of the object that was updated
* `args.table`
  The database table that was operated on
* `args.obj`
  The data that was updated
* `args.oldObj`
  The value of the object pre update
* `args.newObj`
  The value of the object post update
* `args.changes`
  The changes that were applied
* `args.user`
  The user carrying out the operation
  
### `preSelect`
* `args.table`
  The database table being operated on
* `args.args`
  The arguments that were passed to the select function
* `args.user`
  The user carrying out the operation
  
### `select`
* `args.table`
  The database table being operated on
* `args.objs`
  The objects that were selected from the database
* `args.user`
  The user carrying out the operation
  
### `preDelete`
* `args.table`
  The database table being operated on
* `args.where`
  The database query
* `args.user`
  The user carrying out the operation
  
### `delete`
* `args.table`
  The database table being operated on
* `args.user`
  The user carrying out the operation

callbacks can be used to modify data flowing to and from the database.  
see [ndx-permissions](https://github.com/ndxbxrme/ndx-permissions) and [ndx-profiler](https://github.com/ndxbxrme/ndx-profiler) for examles  

#### `db.off(string callbackName, function callback) -> db`

Unregister a callback

#### `db.select(string table, object whereObj, function callback)`

Select data  

#### `db.insert(string table, object insertObj, function callback)`

Insert data

#### `db.update(string table, object updateObj, object whereObj, function callback)`

Update data

#### `db.upsert(string table, object upsertObj, object whereObj, function callback)`

Upsert data

#### `db.delete(string table, object whereObj, function callback)`

Delete data  

#### `db.exec(string sql, array props, bool notCritical) -> data`

Execute an SQL command

#### `db.serverExec(string type, object args)`

Used internally

#### `db.maintenanceOn()`

Turn on maintenance mode

#### `db.maintenanceOff()`

Turn off maintenance mode

#### `db.maintenance() -> bool`

Get the maintenance mode status of the database

#### `db.getDb() -> ndxdb`

Gets a reference to the current database

#### `db.restoreFromBackup(ndxdb data)`

Restore the database from a backup

#### `db.consolidate()`

Cleans up data fragments and saves the main database file

#### `db.maintenanceOn()`

Turn on maintenance mode

### Properties
<a name="properties"></a>
#### `db.alasql`

The current [alasql](https://github.com/agershun/alasql) instance 










