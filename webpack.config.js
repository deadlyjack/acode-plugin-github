const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = (env, options) => {
  const { mode = 'development' } = options;

  if (mode === 'production') {
    fs.rmdirSync(path.resolve(__dirname, 'dist'), { recursive: true });
  }

  const rules = [
    {
      test: /\.m?js$/,
      use: [
        'html-tag-js/jsx/tag-loader.js',
        {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      ],
    },
  ];

  const main = {
    mode,
    entry: {
      main: './src/main.js',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      chunkFilename: '[name].js',
    },
    module: {
      rules,
    },
    resolve: {
      fallback: {
        path: require.resolve('path-browserify'),
      },
    },
    plugins: [
      {
        apply: (compiler) => {
          compiler.hooks.afterDone.tap('pack-zip', () => {
            // run pack-zip.js
            exec('node .vscode/pack-zip.js', (err, stdout, stderr) => {
              if (err) {
                console.error(err);
                return;
              }
              console.log(stdout);
            });
          });
        }
      }
    ],
  };

  return [main];
}