(function() {
  var db, test;

  db = require('../database.js').config({
    database: 'testdb',
    tables: ['table1', 'table2'],
    autoId: '_id',
    localStorage: './data'
  }).on('ready', function() {
    return test();
  }).start();

  test = function() {
    var result, vals;
    if (!db.maintenance()) {
      vals = [
        {
          country: 'China',
          population: 1371220000
        }, {
          country: 'India',
          population: 1311050000
        }, {
          country: 'United States',
          population: 321418000
        }
      ];
      db.exec('INSERT INTO table1 SELECT * FROM ?', [vals]);
      result = db.exec('SELECT * FROM table1 WHERE population > ? ORDER BY population ASC', [500000000]);
      return console.log('result', result);
    }
  };

}).call(this);

//# sourceMappingURL=test.js.map
