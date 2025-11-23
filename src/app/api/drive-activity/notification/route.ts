import { postContentToWebHook } from '@/app/(main)/(pages)/connections/_actions/discord-connection'
import { onCreateNewPageInDatabase } from '@/app/(main)/(pages)/connections/_actions/notion-connection'
import { postMessageToSlack } from '@/app/(main)/(pages)/connections/_actions/slack-connection'
import { db } from '@/lib/db'
import axios from 'axios'
import { headers } from 'next/headers'
import { NextRequest } from 'next/server'

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

    if (channelResourceId) {
        console.log('🔍 Looking for user with googleResourceId:', channelResourceId)
        
        const user = await db.user.findFirst({
            where: {
                googleResourceId: channelResourceId,
            },
            select: { clerkId: true, credits: true, googleResourceId: true },
        })
        
        console.log('👤 User found:', user ? { clerkId: user.clerkId, credits: user.credits, googleResourceId: user.googleResourceId } : 'NO USER FOUND')
        
        if (!user) {
            console.log('⚠️ No user found with googleResourceId:', channelResourceId)
            // Try to find all users to debug
            const allUsers = await db.user.findMany({ select: { clerkId: true, googleResourceId: true } })
            console.log('📋 All users googleResourceIds:', allUsers.map(u => ({ id: u.clerkId, resourceId: u.googleResourceId })))
        }
        
        if ((user && parseInt(user.credits!) > 0) || user?.credits == 'Unlimited') {
            const workflow = await db.workflows.findMany({
                where: {
                    userId: user.clerkId,
                    publish: true,
                },
            })
            
            console.log('🔍 Found workflows:', workflow.length, 'published workflows')
            
            if (workflow && workflow.length > 0) {
                workflow.map(async (flow) => {
                    console.log('⚙️ Processing workflow:', flow.name, 'ID:', flow.id)
                    const flowPath = JSON.parse(flow.flowPath!)
                    console.log('📋 Flow path:', flowPath)
                    let current = 0
                    while (current < flowPath.length) {
                        console.log(`🔄 Processing step ${current + 1}/${flowPath.length}: ${flowPath[current]}`)
                        
                        if (flowPath[current] == 'Discord') {
                            const discordMessage = await db.discordWebhook.findFirst({
                                where: {
                                    userId: flow.userId,
                                },
                                select: {
                                    url: true,
                                },
                            })
                            if (discordMessage) {
                                console.log('💬 Sending to Discord:', flow.discordTemplate)
                                await postContentToWebHook(
                                    flow.discordTemplate!,
                                    discordMessage.url
                                )
                                console.log('✅ Discord message sent')
                            } else {
                                console.log('⚠️ Discord webhook not found')
                            }
                        }
                        if (flowPath[current] == 'Slack') {
                            const channels = flow.slackChannels.map((channel) => {
                                return {
                                    label: '',
                                    value: channel,
                                }
                            })
                            console.log('💬 Sending to Slack:', flow.slackTemplate, 'Channels:', channels)
                            await postMessageToSlack(
                                flow.slackAccessToken!,
                                channels,
                                flow.slackTemplate!
                            )
                            console.log('✅ Slack message sent')
                        }
                        if (flowPath[current] == 'Notion') {
                            console.log('💬 Sending to Notion:', flow.notionTemplate)
                            const notionContent = JSON.parse(flow.notionTemplate!)
                            // Extract just the file name if it's an object, otherwise use as-is
                            const contentToSend = typeof notionContent === 'object' && notionContent.name 
                                ? notionContent.name 
                                : typeof notionContent === 'string' 
                                    ? notionContent 
                                    : JSON.stringify(notionContent)
                            console.log('📄 Extracted content for Notion:', contentToSend)
                            await onCreateNewPageInDatabase(
                                flow.notionDbId!,
                                flow.notionAccessToken!,
                                contentToSend
                            )
                            console.log('✅ Notion page created')
                        }

                        if (flowPath[current] == 'Wait') {
                            console.log('⏰ Setting up Wait/Cron job')
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
                                const cronPath = await db.workflows.update({
                                    where: {
                                        id: flow.id,
                                    },
                                    data: {
                                        cronPath: JSON.stringify(flowPath.slice(current + 1)),
                                    },
                                })
                                console.log('✅ Cron job configured')
                                if (cronPath) break
                            }
                            break
                        }
                        current++
                    }
                    
                    console.log('🏁 Workflow execution completed')

                })
                
                // Deduct 1 credit after processing all workflows
                if (user.credits !== 'Unlimited') {
                    await db.user.update({
                        where: {
                            clerkId: user.clerkId,
                        },
                        data: {
                            credits: `${parseInt(user.credits!) - 1}`,
                        },
                    })
                    console.log('💳 Credit deducted. Remaining:', parseInt(user.credits!) - 1)
                }
                
                return Response.json(
                    {
                        message: 'flow completed',
                    },
                    {
                        status: 200,
                    }
                )
            } else {
                console.log('⚠️ No published workflows found for this user')
            }
        } else {
            console.log('⚠️ User not found or insufficient credits. User:', user?.clerkId, 'Credits:', user?.credits)
        }
    } else {
        console.log('⚠️ No channelResourceId in headers')
    }
    return Response.json(
        {
            message: 'success',
        },
        {
            status: 200,
        }
    )
}