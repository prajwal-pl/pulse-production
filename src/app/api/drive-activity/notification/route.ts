import { postContentToWebHook } from '@/app/(main)/(pages)/connections/_actions/discord-connection'
import { onCreateNewPageInDatabase } from '@/app/(main)/(pages)/connections/_actions/notion-connection'
import { postMessageToSlack } from '@/app/(main)/(pages)/connections/_actions/slack-connection'
import { db } from '@/lib/db'
import axios from 'axios'
import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { Workflows } from '@prisma/client'

// Type for workflow execution result
interface WorkflowExecutionResult {
    workflowId: string
    workflowName: string
    success: boolean
    stepsCompleted: number
    totalSteps: number
    errors: string[]
}

// Helper function to safely parse JSON
function safeJsonParse<T>(jsonString: string | null | undefined, fallback: T): T {
    if (!jsonString) return fallback
    try {
        return JSON.parse(jsonString) as T
    } catch (error) {
        console.error('❌ JSON parse error:', error)
        return fallback
    }
}

// Helper function to check if user has valid credits
function hasValidCredits(credits: string | null | undefined): boolean {
    if (!credits) return false
    if (credits === 'Unlimited') return true
    const numCredits = parseInt(credits, 10)
    return !isNaN(numCredits) && numCredits > 0
}

// Helper function to extract content for Notion
function extractNotionContent(notionTemplate: string | null | undefined): string {
    if (!notionTemplate) return 'Untitled'

    const parsed = safeJsonParse<any>(notionTemplate, null)

    if (parsed === null) {
        // If it's not valid JSON, return the raw string (trimmed)
        return notionTemplate.trim() || 'Untitled'
    }

    // If it's an object with a name property, extract it
    if (typeof parsed === 'object' && parsed.name) {
        return String(parsed.name)
    }

    // If it's already a string after parsing
    if (typeof parsed === 'string') {
        return parsed
    }

    // Fallback: stringify the object
    return JSON.stringify(parsed)
}

// Process a single workflow
async function processWorkflow(flow: Workflows): Promise<WorkflowExecutionResult> {
    const result: WorkflowExecutionResult = {
        workflowId: flow.id,
        workflowName: flow.name,
        success: true,
        stepsCompleted: 0,
        totalSteps: 0,
        errors: []
    }

    console.log('⚙️ Processing workflow:', flow.name, 'ID:', flow.id)

    // Parse flowPath safely
    const flowPath = safeJsonParse<string[]>(flow.flowPath, [])

    if (flowPath.length === 0) {
        console.log('⚠️ No flow path defined for workflow:', flow.name)
        result.success = false
        result.errors.push('No flow path defined')
        return result
    }

    result.totalSteps = flowPath.length
    console.log('📋 Flow path:', flowPath)

    let current = 0
    while (current < flowPath.length) {
        const currentStep = flowPath[current]
        console.log(`🔄 Processing step ${current + 1}/${flowPath.length}: ${currentStep}`)

        try {
            if (currentStep === 'Discord') {
                const discordMessage = await db.discordWebhook.findFirst({
                    where: {
                        userId: flow.userId,
                    },
                    select: {
                        url: true,
                    },
                })

                if (discordMessage?.url) {
                    const template = flow.discordTemplate || ''
                    if (template.trim()) {
                        console.log('💬 Sending to Discord:', template)
                        const discordResult = await postContentToWebHook(template, discordMessage.url)
                        if (discordResult.message === 'success') {
                            console.log('✅ Discord message sent')
                            result.stepsCompleted++
                        } else {
                            console.log('⚠️ Discord send issue:', discordResult.message)
                            result.errors.push(`Discord: ${discordResult.message}`)
                        }
                    } else {
                        console.log('⚠️ Discord template is empty, skipping')
                        result.errors.push('Discord template is empty')
                    }
                } else {
                    console.log('⚠️ Discord webhook not found for user:', flow.userId)
                    result.errors.push('Discord webhook not configured')
                }
            }

            else if (currentStep === 'Slack') {
                // Check if we have channels configured
                if (flow.slackChannels && flow.slackChannels.length > 0) {
                    const channels = flow.slackChannels.map((channel) => ({
                        label: '',
                        value: channel,
                    }))

                    const template = flow.slackTemplate || ''
                    const accessToken = flow.slackAccessToken

                    if (template.trim() && accessToken) {
                        console.log('💬 Sending to Slack:', template, 'Channels:', channels.map(c => c.value))
                        const slackResult = await postMessageToSlack(accessToken, channels, template)
                        if (slackResult.message === 'Success') {
                            console.log('✅ Slack message sent')
                            result.stepsCompleted++
                        } else {
                            console.log('⚠️ Slack send issue:', slackResult.message)
                            result.errors.push(`Slack: ${slackResult.message}`)
                        }
                    } else {
                        console.log('⚠️ Slack template or access token missing')
                        result.errors.push('Slack template or access token missing')
                    }
                } else {
                    console.log('⚠️ No Slack channels configured for workflow:', flow.name)
                    result.errors.push('No Slack channels configured')
                }
            }

            else if (currentStep === 'Notion') {
                const notionDbId = flow.notionDbId
                const notionAccessToken = flow.notionAccessToken

                if (notionDbId && notionAccessToken) {
                    console.log('💬 Sending to Notion, raw template:', flow.notionTemplate)
                    const contentToSend = extractNotionContent(flow.notionTemplate)
                    console.log('📄 Extracted content for Notion:', contentToSend)

                    try {
                        await onCreateNewPageInDatabase(notionDbId, notionAccessToken, contentToSend)
                        console.log('✅ Notion page created')
                        result.stepsCompleted++
                    } catch (notionError: any) {
                        console.error('❌ Notion error:', notionError.message)
                        result.errors.push(`Notion: ${notionError.message}`)
                    }
                } else {
                    console.log('⚠️ Notion database ID or access token missing')
                    result.errors.push('Notion database ID or access token missing')
                }
            }

            else if (currentStep === 'Wait') {
                console.log('⏰ Setting up Wait/Cron job')
                try {
                    const res = await axios.put(
                        'https://api.cron-job.org/jobs',
                        {
                            job: {
                                url: `${process.env.NGROK_URI}?flow_id=${flow.id}`,
                                enabled: 'true',
                                schedule: {
                                    timezone: 'Europe/Istanbul',
                                    expiresAt: 0,
                                    hours: [-1],
                                    mdays: [-1],
                                    minutes: ['*****'],
                                    months: [-1],
                                    wdays: [-1],
                                },
                            },
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${process.env.CRON_JOB_KEY!}`,
                                'Content-Type': 'application/json',
                            },
                        }
                    )
                    if (res) {
                        await db.workflows.update({
                            where: {
                                id: flow.id,
                            },
                            data: {
                                cronPath: JSON.stringify(flowPath.slice(current + 1)),
                            },
                        })
                        console.log('✅ Cron job configured')
                        result.stepsCompleted++
                        break // Stop processing after Wait
                    }
                } catch (cronError: any) {
                    console.error('❌ Cron job error:', cronError.message)
                    result.errors.push(`Cron: ${cronError.message}`)
                }
                break // Always break after Wait attempt
            }

            else if (currentStep === 'Google Drive') {
                // Skip Google Drive node - it's the trigger, not an action
                console.log('ℹ️ Skipping Google Drive node (trigger node)')
                result.stepsCompleted++
            }

            else {
                console.log('⚠️ Unknown step type:', currentStep)
                result.errors.push(`Unknown step type: ${currentStep}`)
            }

        } catch (stepError: any) {
            console.error(`❌ Error in step ${currentStep}:`, stepError.message)
            result.errors.push(`${currentStep}: ${stepError.message}`)
            result.success = false
        }

        current++
    }

    result.success = result.errors.length === 0
    console.log('🏁 Workflow execution completed:', {
        name: flow.name,
        stepsCompleted: result.stepsCompleted,
        totalSteps: result.totalSteps,
        success: result.success,
        errors: result.errors
    })

    return result
}

export async function POST(req: NextRequest) {
    const headersList = await headers()
    let channelResourceId: string | undefined
    let resourceState: string | undefined

    headersList.forEach((value, key) => {
        if (key === 'x-goog-resource-id') {
            channelResourceId = value
        }
        if (key === 'x-goog-resource-state') {
            resourceState = value
        }
    })

    console.log('📬 Drive Activity Notification:', {
        resourceId: channelResourceId,
        state: resourceState,
        timestamp: new Date().toISOString()
    })

    // Ignore sync notifications - these are just confirmation that the watch was set up
    if (resourceState === 'sync') {
        console.log('ℹ️ Received sync notification - watch confirmed, no action needed')
        return Response.json({ message: 'sync acknowledged' }, { status: 200 })
    }

    if (!channelResourceId) {
        console.log('⚠️ No channelResourceId in headers')
        return Response.json({ message: 'no resource id' }, { status: 200 })
    }

    console.log('🔍 Looking for user with googleResourceId:', channelResourceId)

    const user = await db.user.findFirst({
        where: {
            googleResourceId: channelResourceId,
        },
        select: { clerkId: true, credits: true, googleResourceId: true },
    })

    if (!user) {
        console.log('⚠️ No user found with googleResourceId:', channelResourceId)
        // Debug: show all users with their resourceIds
        const allUsers = await db.user.findMany({
            select: { clerkId: true, googleResourceId: true }
        })
        console.log('📋 All users googleResourceIds:', allUsers.map(u => ({
            id: u.clerkId,
            resourceId: u.googleResourceId
        })))
        return Response.json({ message: 'user not found' }, { status: 200 })
    }

    console.log('👤 User found:', {
        clerkId: user.clerkId,
        credits: user.credits,
        googleResourceId: user.googleResourceId
    })

    // Check credits with proper validation
    if (!hasValidCredits(user.credits)) {
        console.log('⚠️ User has insufficient credits:', user.credits)
        return Response.json({ message: 'insufficient credits' }, { status: 200 })
    }

    // Find published workflows
    const workflows = await db.workflows.findMany({
        where: {
            userId: user.clerkId,
            publish: true,
        },
    })

    console.log('🔍 Found workflows:', workflows.length, 'published workflows')

    if (!workflows || workflows.length === 0) {
        console.log('⚠️ No published workflows found for this user')
        return Response.json({ message: 'no published workflows' }, { status: 200 })
    }

    // Process all workflows with proper await using Promise.all
    const results: WorkflowExecutionResult[] = []

    for (const flow of workflows) {
        try {
            const result = await processWorkflow(flow)
            results.push(result)
        } catch (workflowError: any) {
            console.error('❌ Critical error processing workflow:', flow.name, workflowError.message)
            results.push({
                workflowId: flow.id,
                workflowName: flow.name,
                success: false,
                stepsCompleted: 0,
                totalSteps: 0,
                errors: [`Critical error: ${workflowError.message}`]
            })
        }
    }

    // Summary of all workflow executions
    const successfulWorkflows = results.filter(r => r.success).length
    const failedWorkflows = results.filter(r => !r.success).length

    console.log('📊 Execution Summary:', {
        total: results.length,
        successful: successfulWorkflows,
        failed: failedWorkflows
    })

    // Deduct 1 credit after processing all workflows (only if at least one succeeded)
    if (successfulWorkflows > 0 && user.credits !== 'Unlimited') {
        const currentCredits = parseInt(user.credits!, 10)
        const newCredits = currentCredits - 1

        await db.user.update({
            where: {
                clerkId: user.clerkId,
            },
            data: {
                credits: String(newCredits),
            },
        })
        console.log('💳 Credit deducted. Remaining:', newCredits)
    }

    return Response.json({
        message: 'flow completed',
        summary: {
            totalWorkflows: results.length,
            successful: successfulWorkflows,
            failed: failedWorkflows
        }
    }, { status: 200 })
}