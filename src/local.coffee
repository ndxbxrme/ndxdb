'use strict'

settings = require './settings'
glob = require 'glob'
fs = require 'fs'
path = require 'path'

module.exports = ->
  clean = (key) ->
    key = key.replace /:/g, '%%'
    key.replace /\//g, '££'
  unclean = (key) ->
    key = key.replace /%%/g, ':'
    key = key.replace /££/g, '/'
    regex = new RegExp '^' + path.join(settings.LOCAL_STORAGE) + '\\\/'
    key.replace regex, ''
  checkDataDir: ->
    if settings.LOCAL_STORAGE
      exists = fs.existsSync path.join(settings.LOCAL_STORAGE)
      if not exists
        fs.mkdirSync path.join(settings.LOCAL_STORAGE)
  keys: (from, prefix, cb) ->
    glob path.join(settings.LOCAL_STORAGE, clean(prefix) + '*.json'), (e, r) ->
      if e
        return cb e, null
      i = -1
      count = 0
      gotFrom = not from
      output = 
        Contents: []
        IsTruncated: false
      while ++i < r.length and count < 1000
        if gotFrom
          output.Contents.push
            Key: unclean r[i].replace('.json', '')
          count++
        else
          if r[i] is from + '.json'
            gotFrom = true
      if i < r.length
        output.IsTruncated = true
      cb? null, output
  del: (key, cb) ->
    fs.unlinkSync path.join(settings.LOCAL_STORAGE, clean(key) + '.json')
    cb? null, null
  put: (key, o, cb) ->
    uri = path.join(settings.LOCAL_STORAGE, clean(key) + '.json')
    fs.writeFile uri, JSON.stringify(o), (e) ->
      cb? e, null
  get: (key, cb) ->
    fs.readFile path.join(settings.LOCAL_STORAGE, clean(key) + '.json'), 'utf8', (e, r) ->
      d = null
      try
        d = JSON.parse r
      catch e
        return cb?(e or 'error', null)
      cb? e, d