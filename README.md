# ndxdb
* a cheap and easy in-memory sql database for nodejs projects that persits to S3 
* built on top of the mighty [alasql](https://github.com/agershun/alasql)
* useful for hobby projects on free servers (heroku) where you don't want the hassle of a database server and don't have reliable on-server file storage 

# In development, think twice before using this!
* ndxdb is currently intended for small (single server) projects and will not scale, though I reckon someone who is good with websockets could help me fix that (hint hint). 
* you should only execute one INSERT, UPDATE OR DELETE command at a time (no chaining with ;) 
* every row in the database must have an id field (named id, _id or i).  id's can be generated automatically by using the `autoId` setting
```
  // examples of good inserts etc
  db.exec('INSERT INTO table1 VALUES ?', [obj]);
  db.exec('INSERT INTO table1 SELECT * FROM ?', [[obj1, obj2, obj3]]);
  db.exec('UPDATE table1 SET country=? WHERE country=?', ['Republic of China', 'China']);
  db.exec('DELETE FROM table1 WHERE population > ?', [500000000]);
```
## Usage
`npm install --save ndxdb`
```javascript
var db = require('ndxdb')({
  database: 'mydb', //database name - required
  tables: ['table1', 'table2'], //database tables - required
  awsBucket: process.env.AWS_BUCKET, //aws info
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsId: process.env.AWS_ID,
  awsKey: process.env.AWS_KEY,
  localStorage: 'data', //you can persist data to a local directory too
  autoId: '_id', //generate id's automatically
  callbacks: {
    ready: function() { //database has been built/rebuilt and is ready to go
      test();
    }
  } //there are also callbacks for insert, update and delete
});
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
  db.exec('INSERT INTO table1 SELECT * FROM ?', [vals]);
  var result = db.exec('SELECT * FROM table1 WHERE population > ? ORDER BY population ASC', [500000000]);
  /*
  result = [
    {
      country: 'India'
      population: 1311050000
    },{
      country: 'China'
      population: 1371220000
    }
  ]
  */
}
```
if you don't set your AWS info or a local storage directory then the database will work as an in-memory database with no persistence

## Environment Variables
most of the database configuration can be set as environment variables instead 
* LOCAL_STORAGE
* DATABASE
* AUTO_ID
* AWS_BUCKET
* AWS_REGION
* AWS_ID
* AWS_KEY 
in which case you can simplify your code 
```javascript
var db = require('ndxdb')({
  tables: ['table1', 'table2']
  callbacks: {
    ready: function() {
      //all good to go
    }
  }
});
```
