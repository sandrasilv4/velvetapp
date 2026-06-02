const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

module.exports = function gerarThumbnail(videoPath) {
  return new Promise((resolve, reject) => {
    const thumbPath = videoPath.replace(/\.[^/.]+$/, ".jpg");

    ffmpeg(videoPath)
      .screenshots({
        timestamps: ["1"],
        filename: path.basename(thumbPath),
        folder: path.dirname(thumbPath),
        size: "600x600"
      })
      .on("end", () => resolve(thumbPath))
      .on("error", reject);
  });
};

