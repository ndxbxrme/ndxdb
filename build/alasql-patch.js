(function() {
  'use strict';
  module.exports = function(alasql) {
    alasql.yy.UniOp.prototype.toString = function() {
      var s;
      s = void 0;
      if (this.op === '~') {
        s = this.op + this.right.toString();
      }
      if (this.op === '-') {
        s = this.op + this.right.toString();
      }
      if (this.op === '+') {
        s = this.op + this.right.toString();
      }
      if (this.op === '#') {
        s = this.op + this.right.toString();
      }
      if (this.op === 'NOT') {
        s = this.op + '(' + this.right.toString() + ')';
      }
      if (this.op === null) {
        s = '(' + this.right.toString() + ')';
      }
      if (!s) {
        s = this.right.toString();
      }
      return s;
    };
    return alasql.yy.Select.prototype.toString = function() {
      var s;
      s = '';
      if (this.explain) {
        s += 'EXPLAIN ';
      }
      s += 'SELECT ';
      if (this.modifier) {
        s += this.modifier + ' ';
      }
      if (this.distinct) {
        s += 'DISTINCT ';
      }
      if (this.top) {
        s += 'TOP ' + this.top.value + ' ';
        if (this.percent) {
          s += 'PERCENT ';
        }
      }
      s += this.columns.map(function(col) {
        var s;
        s = col.toString();
        if (typeof col.as !== 'undefined') {
          s += ' AS ' + col.as;
        }
        return s;
      }).join(', ');
      if (this.from) {
        s += ' FROM ' + this.from.map(function(f) {
          var ss;
          ss = f.toString();
          if (f.as) {
            ss += ' AS ' + f.as;
          }
          return ss;
        }).join(',');
      }
      if (this.joins) {
        s += this.joins.map(function(jn) {
          var ss;
          ss = ' ';
          if (jn.joinmode) {
            ss += jn.joinmode + ' ';
          }
          if (jn.table) {
            ss += 'JOIN ' + jn.table.toString();
          } else if (jn.select) {
            ss += 'JOIN (' + jn.select.toString() + ')';
          } else if (jn instanceof alasql.yy.Apply) {
            ss += jn.toString();
          } else {
            throw new Error('Wrong type in JOIN mode');
          }
          if (jn.as) {
            ss += ' AS ' + jn.as;
          }
          if (jn.using) {
            ss += ' USING ' + jn.using.toString();
          }
          if (jn.on) {
            ss += ' ON ' + jn.on.toString();
          }
          return ss;
        });
      }
      if (this.where) {
        s += ' WHERE ' + this.where.toString();
      }
      if (this.group && this.group.length > 0) {
        s += ' GROUP BY ' + this.group.map(function(grp) {
          return grp.toString();
        }).join(', ');
      }
      if (this.having) {
        s += ' HAVING ' + this.having.toString();
      }
      if (this.order && this.order.length > 0) {
        s += ' ORDER BY ' + this.order.map(function(ord) {
          return ord.toString();
        }).join(', ');
      }
      if (this.limit) {
        s += ' LIMIT ' + this.limit.value;
      }
      if (this.offset) {
        s += ' OFFSET ' + this.offset.value;
      }
      if (this.union) {
        s += ' UNION ' + (this.corresponding ? 'CORRESPONDING ' : '') + this.union.toString();
      }
      if (this.unionall) {
        s += ' UNION ALL ' + (this.corresponding ? 'CORRESPONDING ' : '') + this.unionall.toString();
      }
      if (this.except) {
        s += ' EXCEPT ' + (this.corresponding ? 'CORRESPONDING ' : '') + this.except.toString();
      }
      if (this.intersect) {
        s += ' INTERSECT ' + (this.corresponding ? 'CORRESPONDING ' : '') + this.intersect.toString();
      }
      return s;
    };
  };

}).call(this);

//# sourceMappingURL=alasql-patch.js.map
