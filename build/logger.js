(function() {
  'use strict';
  var settings;

  settings = require('./settings');

  module.exports = {
    log: function(text, priority) {
      if (settings.ENV === priority || (!priority && settings.ENV === 'DEBUG')) {
        return console.log(text);
      }
    }
  };

}).call(this);

//# sourceMappingURL=logger.js.map
