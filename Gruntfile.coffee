module.exports = (grunt) ->
  require('load-grunt-tasks') grunt
  grunt.initConfig
    watch:
      coffee:
        files: ['src/**/*.coffee']
        tasks: ['build']
    coffee:
      options:
        sourceMap: true
      default:
        files: [{
          expand: true
          cwd: 'src'
          src: ['**/*.coffee']
          dest: 'build'
          ext: '.js'
        }]
    clean:
      build: 'build'
      html: 'build/client/*/**/*.html'
  grunt.registerTask 'build', [
    'clean:build'
    'coffee'
  ]
  grunt.registerTask 'default', [
    'build'
    'watch'
  ]