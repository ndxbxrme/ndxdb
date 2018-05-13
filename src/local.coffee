'use strict'

settings = require './settings'
glob = require 'glob'
fs = require 'fs'
path = require 'path'

module.exports = ->
  clean = (key) ->
    key = key.replace /:/g, 'IDBI'
    key.replace /\//g, 'IIDI'
  unclean = (key) ->
    key = key.replace /IDBI/g, ':'
    key = key.replace /IIDI/g, '/'
    regex = new RegExp '^' + path.join(settings.LOCAL_STORAGE) + '\\\/'
    key.replace regex, ''
  checkDataDir: ->
    if settings.LOCAL_STORAGE
      exists = fs.existsSync path.join(settings.LOCAL_STORAGE)
      if not exists
        fs.mkdirSync path.join(settings.LOCAL_STORAGE)
  keys: (from, prefix, cb) ->
    ls = path.join(settings.LOCAL_STORAGE).replace(/\\/g, '/') + '/'
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
        r[i] = r[i].replace ls, ''
        console.log ls
        if gotFrom
          output.Contents.push
            Key: unclean r[i].replace('.json', '')
          count++
        else
          if unclean(r[i]) is from + '.json'
            gotFrom = true
      if i < r.length
        output.IsTruncated = true
      cb? null, output
  del: (key, cb) ->
    console.log clean(key)
    try
      fs.unlinkSync path.join(settings.LOCAL_STORAGE, clean(key) + '.json')
      cb? null, null
    catch e
      cb? e, null
  put: (key, o, cb) ->
    uri = path.join(settings.LOCAL_STORAGE, clean(key) + '.json')
    fs.writeFile uri, JSON.stringify(o), (e) ->
      cb? e, null
  get: (key, cb) ->
    fs.readFile path.join(settings.LOCAL_STORAGE, clean(key) + '.json'), 'utf8', (e, r) ->
      d = null
      if e and e.code and e.code is 'ENOENT'
        return cb? 'ENOENT', null
      try
        d = JSON.parse r
      catch e
        return cb?(e or 'error', null)
      cb? e, d
  getReadStream: (key) ->
    fs.createReadStream path.join(settings.LOCAL_STORAGE, clean(key) + '.json')
  getWriteStream: (key, errorCb) ->
    uri = path.join(settings.LOCAL_STORAGE, clean(key) + '.json')
    fs.createWriteStream uri