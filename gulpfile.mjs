import babel from 'gulp-babel';
import filters from 'gulp-filter';
import gulp from 'gulp';
import rename from 'gulp-rename';
import sass from 'gulp-dart-sass';
import { promisify } from 'util';
import { compileAsync } from 'sass'
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const writeFile = promisify(fs.writeFile);

gulp.task('sass', async function () {
  try {
    const scssDir = './assets/sass';
    const outputDir = './resources/css';

    const privateScssDir = './private/sass';

    // Ensure the private sass directory exists
    fs.mkdirSync(privateScssDir, { recursive: true });
    // Create an optional _custom.scss file if it doesn't exist
    const optionalCustomCss = path.join(privateScssDir, '_custom.scss');
    if (!fs.existsSync(optionalCustomCss)) {
      fs.writeFileSync(
        optionalCustomCss,
        '// auto-generated stub for optional custom overrides\n'
      );
    }

    const files = fs.readdirSync(scssDir);

    const scssFiles = files.filter(file => path.extname(file) === '.scss');

    for (const file of scssFiles) {
      const inputPath = path.join(scssDir, file);
      const outputPath = path.join(outputDir, path.basename(file, '.scss') + '.css');

      const result = await compileAsync(inputPath, {
        loadPaths: [scssDir],
      });

      await writeFile(outputPath, result.css);
      console.log(`Compiled ${file} to ${outputPath}`);
    }
  } catch (error) {
    console.error('Error compiling Sass:', error);
  }
});

gulp.task('js', function () {
  return gulp
    .src('./assets/js/**/*.js')
    .pipe(babel({
      presets: ['@babel/env'],
      ignore: ['assets/js/sync-to-drive.js', 'assets/js/remotebuzzer-server.js']
    }))
    .pipe(gulp.dest('./resources/js'));
});

async function generateAssetRevisions() {
    const resourcesFolder = 'resources';
    const revisionsManifest = 'resources/revisions.json';
    const manifest = {};

    const processFile = async (filePath) => {
        const content = fs.readFileSync(filePath);
        const sha1Hash = crypto.createHash('sha1').update(content).digest('hex');
        const relativePath = path.relative(resourcesFolder, filePath).replace(/\\/g, '/');
        manifest[resourcesFolder + '/' + relativePath] = sha1Hash;
    };

    const processFolder = async (folderPath) => {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                await processFolder(filePath);
            } else if (stats.isFile() && !filePath.endsWith('revisions.json')) {
                await processFile(filePath);
            }
        }
    };

    await processFolder(resourcesFolder);

    const manifestJSON = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(revisionsManifest, manifestJSON);
}

gulp.task('default', gulp.series(
    gulp.parallel('sass', 'js'),
    generateAssetRevisions
));

gulp.task('watch', function () {
  gulp.watch(['assets/js/**/*.js'], gulp.series('js', generateAssetRevisions));
  gulp.watch(['assets/sass/**/*.scss', 'private/sass/**/*.scss'], gulp.series('sass', generateAssetRevisions));
});
