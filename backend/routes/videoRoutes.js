const express = require("express");
const videoController = require("../controllers/videoController");

const router = express.Router();

router.get("/", videoController.listVideos);
router.get("/:id/search", videoController.searchTranscript);
router.get("/:id", videoController.getVideo);

module.exports = router;