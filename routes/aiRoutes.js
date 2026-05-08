const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

router.get('/start', aiController.startOnboarding);
router.post('/chat', aiController.chat); // Yangi xabarlar uchun
router.post('/analyze-writing', aiController.analyzeWriting);
router.post('/validate-vocabulary', aiController.validateVocabulary);
router.post('/validate-listening-summary', aiController.validateListeningSummary);
router.post('/check-writing', aiController.checkDashboardWriting);
router.post('/check-dashboard-writing', aiController.checkDashboardWriting);
router.post('/evaluate-writing-tasks', aiController.evaluateDashboardWritingThreeTasks);
router.post('/writing-feedback', aiController.feedbackDashboardWriting);
router.post('/writing-three-tasks-feedback', aiController.feedbackWritingThreeTasks);
router.post('/reading-exam-feedback', aiController.analyzeReadingExamMistakes);
router.post('/grammar-quiz-feedback', aiController.analyzeGrammarQuizMistakes);
router.post('/validate-dictation', aiController.validateDictationAgainstTranscript);

module.exports = router;
