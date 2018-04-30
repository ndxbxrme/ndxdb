(function() {
  var db;

  db = require('../database.js').config({
    database: 'callbacks',
    tables: ['t1']
  }).on('ready', function() {
    db.on('preSelect', function(data, cb) {
      console.log('pre select');
      return cb();
    });
    db.on('select', function(data, cb) {
      console.log('select', data);
      if (data.table === 't1') {
        console.log('switchin stuff');
        //data.objs.splice 0, 1
        data.objs.push({
          boom: 'baam'
        });
      }
      return cb();
    });
    db.on('preUpdate', function(data, cb) {
      console.log('pre update');
      return cb();
    });
    db.on('update', function(data, cb) {
      console.log('update');
      return cb();
    });
    db.on('preInsert', function(data, cb) {
      console.log('pre insert');
      return cb();
    });
    db.on('insert', function(data, cb) {
      console.log('insert');
      return cb();
    });
    db.on('preDelete', function(data, cb) {
      console.log('pre delete');
      return cb();
    });
    db.on('delete', function(data, cb) {
      console.log('delete');
      return cb();
    });
    db.insert('t1', {
      my: 'thing'
    });
    return db.select('t1', {
      page: 2,
      pageSize: 1
    }, function(things, total) {
      return console.log(things, total);
    });
  }).start();

}).call(this);

//# sourceMappingURL=callbacks.js.map
