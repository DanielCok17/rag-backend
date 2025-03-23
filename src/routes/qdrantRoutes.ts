import express, { Request, Response, Router, RequestHandler } from 'express';
import { retrievalService } from '../services/retrievalService';
import { loggerService } from '../services/loggerService';
import { z } from 'zod';

const router: Router = express.Router();

// Schema for request validation
const GetRecordSchema = z.object({
    recordId: z.string().min(1, 'Record ID is required')
});

const GetCaseSchema = z.object({
    caseId: z.string().min(1, 'Case ID is required')
});

/**
 * @swagger
 * /api/qdrant/record/{recordId}:
 *   get:
 *     summary: Get a Qdrant record by ID
 *     description: Retrieves and translates a Qdrant record with its metadata and vector data
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the Qdrant record to retrieve
 *     responses:
 *       200:
 *         description: Successfully retrieved the Qdrant record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: UUID of the record
 *                 score:
 *                   type: number
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     title:
 *                       type: string
 *                     url:
 *                       type: string
 *                     pdfUrl:
 *                       type: string
 *                     caseId:
 *                       type: string
 *                     court:
 *                       type: string
 *                     caseNumber:
 *                       type: string
 *                     decisionDate:
 *                       type: string
 *                     judge:
 *                       type: string
 *                     ecli:
 *                       type: string
 *                     decisionForm:
 *                       type: string
 *                     legalArea:
 *                       type: string
 *                     legalSubArea:
 *                       type: string
 *                     decisionNature:
 *                       type: string
 *                     legalReferences:
 *                       type: object
 *                     content:
 *                       type: string
 *                     summary:
 *                       type: string
 *                     text:
 *                       type: string
 *                     type:
 *                       type: string
 *                     chunkIndex:
 *                       type: number
 *                     totalChunks:
 *                       type: number
 *                     originalId:
 *                       type: string
 *                 vector:
 *                   type: array
 *                   items:
 *                     type: number
 *       404:
 *         description: Record not found
 *       500:
 *         description: Internal server error
 */
const getRecordHandler: RequestHandler<{ recordId: string }> = async (req, res) => {
    try {
        const { recordId } = GetRecordSchema.parse({
            recordId: req.params.recordId
        });

        loggerService.logWorkflowStep('Processing Qdrant Record Request', {
            recordId
        });

        const record = await retrievalService.getQdrantRecord(recordId);

        loggerService.logWorkflowStep('Qdrant Record Request Complete', {
            recordId,
            metadataFields: Object.keys(record.metadata)
        });

        res.json(record);
    } catch (error) {
        if (error instanceof z.ZodError) {
            loggerService.warn('Invalid request parameters', {
                errors: error.errors
            });
            res.status(400).json({
                error: 'Invalid request parameters',
                details: error.errors
            });
            return;
        }

        if (error instanceof Error && error.message.includes('not found')) {
            loggerService.warn('Record not found', {
                recordId: req.params.recordId
            });
            res.status(404).json({
                error: 'Record not found',
                message: error.message
            });
            return;
        }

        loggerService.logError(error as Error, 'Qdrant Record Request');
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve Qdrant record'
        });
    }
};

router.get('/record/:recordId', getRecordHandler);

/**
 * @swagger
 * /api/qdrant/case/{caseId}:
 *   get:
 *     summary: Get all Qdrant records for a specific case ID
 *     description: Retrieves and translates all Qdrant records associated with a case ID
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema:
 *           type: string
 *         description: The case ID (Identifikačné číslo spisu) to search for
 *     responses:
 *       200:
 *         description: Successfully retrieved the Qdrant records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   score:
 *                     type: number
 *                   metadata:
 *                     type: object
 *                   vector:
 *                     type: array
 *                     items:
 *                       type: number
 *       404:
 *         description: No records found for the case ID
 *       500:
 *         description: Internal server error
 */
const getCaseRecordsHandler: RequestHandler<{ caseId: string }> = async (req, res) => {
    try {
        // Validate request parameters
        const { caseId } = GetCaseSchema.parse({
            caseId: req.params.caseId
        });
        
        // Log the request
        loggerService.logWorkflowStep('Fetching Records by Case ID', { caseId });
        
        // Get records by case ID using retrievalService
        const records = await retrievalService.getRecordsByCaseId(caseId);
        
        // Return the records
        res.json(records);
    } catch (error) {
        // Handle different types of errors
        if (error instanceof z.ZodError) {
            loggerService.warn('Invalid Case ID', { error: error.errors });
            res.status(400).json({
                error: 'Invalid Case ID',
                details: error.errors
            });
            return;
        }
        
        if (error instanceof Error && error.message.includes('not found')) {
            loggerService.warn('No Records Found', { caseId: req.params.caseId });
            res.status(404).json({
                error: 'No records found for this case ID'
            });
            return;
        }
        
        loggerService.logError(error as Error, 'Case Records Retrieval');
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve case records'
        });
    }
};

router.get('/case/:caseId', getCaseRecordsHandler);

export default router; 