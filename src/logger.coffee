'use strict'
settings = require './settings'
module.exports =
  log: (text, priority) ->
    if settings.ENV is priority or (not priority and settings.ENV is 'DEBUG')
      console.log text