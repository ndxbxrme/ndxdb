'use strict'

module.exports = (alasql) ->
  alasql.yy.UniOp::toString = ->
    s = undefined
    if @op == '~'
      s = @op + @right.toString()
    if @op == '-'
      s = @op + @right.toString()
    if @op == '+'
      s = @op + @right.toString()
    if @op == '#'
      s = @op + @right.toString()
    if @op == 'NOT'
      s = @op + '(' + @right.toString() + ')'
    # Please avoid === here
    if @op == null
      # jshint ignore:line
      s = '(' + @right.toString() + ')'
    if not s
      s = @right.toString()
    s
  alasql.yy.Select::toString = ->
    s = ''
    if @explain
      s += 'EXPLAIN '
    s += 'SELECT '
    if @modifier
      s += @modifier + ' '
    if @distinct
      s += 'DISTINCT '
    if @top
      s += 'TOP ' + @top.value + ' '
      if @percent
        s += 'PERCENT '
    s += @columns.map((col) ->
      `var s`
      s = col.toString()
      if typeof col.as != 'undefined'
        s += ' AS ' + col.as
      s
    ).join(', ')
    if @from
      s += ' FROM ' + @from.map((f) ->
        ss = f.toString()
        if f.as
          ss += ' AS ' + f.as
        ss
      ).join(',')
    if @joins
      s += @joins.map((jn) ->
        ss = ' '
        if jn.joinmode
          ss += jn.joinmode + ' '
        if jn.table
          ss += 'JOIN ' + jn.table.toString()
        else if jn.select
          ss += 'JOIN (' + jn.select.toString() + ')';
        else if jn instanceof alasql.yy.Apply
          ss += jn.toString()
        else
          throw new Error('Wrong type in JOIN mode')
        if jn.as
          ss += ' AS ' + jn.as
        if jn.using
          ss += ' USING ' + jn.using.toString()
        if jn.on
          ss += ' ON ' + jn.on.toString()
        ss
      )
    if @where
      s += ' WHERE ' + @where.toString()
    if @group and @group.length > 0
      s += ' GROUP BY ' + @group.map((grp) ->
        grp.toString()
      ).join(', ')
    if @having
      s += ' HAVING ' + @having.toString()
    if @order and @order.length > 0
      s += ' ORDER BY ' + @order.map((ord) ->
        ord.toString()
      ).join(', ')
    if @limit
      s += ' LIMIT ' + @limit.value
    if @offset
      s += ' OFFSET ' + @offset.value
    if @union
      s += ' UNION ' + (if @corresponding then 'CORRESPONDING ' else '') + @union.toString()
    if @unionall
      s += ' UNION ALL ' + (if @corresponding then 'CORRESPONDING ' else '') + @unionall.toString()
    if @except
      s += ' EXCEPT ' + (if @corresponding then 'CORRESPONDING ' else '') + @except.toString()
    if @intersect
      s += ' INTERSECT ' + (if @corresponding then 'CORRESPONDING ' else '') + @intersect.toString()
    s