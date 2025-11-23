import { google } from 'googleapis'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { clerkClient } from '@clerk/nextjs/server'

export async function DELETE() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.OAUTH2_REDIRECT_URI
    )

    const { userId } = await auth()
    if (!userId) {
        return NextResponse.json({ message: 'User not found' })
    }

    const clerkResponse = await clerkClient.users.getUserOauthAccessToken(
        userId,
        'oauth_google'
    )

    const accessToken = clerkResponse[0].token
    oauth2Client.setCredentials({
        access_token: accessToken,
    })

    const drive = google.drive({
        version: 'v3',
        auth: oauth2Client,
    })

    // Get the user's current channel info
    const user = await db.user.findUnique({
        where: { clerkId: userId },
        select: { googleResourceId: true }
    })

    if (!user?.googleResourceId) {
        return NextResponse.json({ message: 'No active listener found' }, { status: 404 })
    }

    try {
        // Stop the channel
        await drive.channels.stop({
            requestBody: {
                id: user.googleResourceId, // Using resourceId as channel id
                resourceId: user.googleResourceId,
            },
        })

        console.log('🛑 Google Drive listener stopped:', {
            resourceId: user.googleResourceId,
        })

        // Clear the resourceId from database
        await db.user.update({
            where: { clerkId: userId },
            data: { googleResourceId: null },
        })

        console.log('💾 Cleared googleResourceId from database for user:', userId)

        return NextResponse.json({ message: 'Listener stopped successfully' })
    } catch (error: any) {
        console.error('❌ Error stopping listener:', error.message)
        // Even if stop fails, clear from database
        await db.user.update({
            where: { clerkId: userId },
            data: { googleResourceId: null },
        })
        return NextResponse.json({ message: 'Listener stopped (cleared from database)' })
    }
}

export async function GET() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.OAUTH2_REDIRECT_URI
    )

    const { userId } = await auth()
    if (!userId) {
        return NextResponse.json({ message: 'User not found' })
    }

    const clerkResponse = await clerkClient.users.getUserOauthAccessToken(
        userId,
        'oauth_google'
    )

    const accessToken = clerkResponse[0].token
    oauth2Client.setCredentials({
        access_token: accessToken,
    })

    const drive = google.drive({
        version: 'v3',
        auth: oauth2Client,
    })

    const channelId = uuidv4()

    const startPageTokenRes = await drive.changes.getStartPageToken({})
    const startPageToken = startPageTokenRes.data.startPageToken
    if (startPageToken == null) {
        throw new Error('startPageToken is unexpectedly null')
    }

    const listener = await drive.changes.watch({
        pageToken: startPageToken,
        supportsAllDrives: true,
        supportsTeamDrives: true,
        requestBody: {
            id: channelId,
            type: 'web_hook',
            address:
                `${process.env.NGROK_URI}/api/drive-activity/notification`,
            kind: 'api#channel',
        },
    })

    if (listener.status == 200) {
        console.log('✅ Google Drive listener created:', {
            channelId: listener.data.id,
            resourceId: listener.data.resourceId,
            expiration: listener.data.expiration,
        })
        
        //if listener created store its channel id in db
        const channelStored = await db.user.updateMany({
            where: {
                clerkId: userId,
            },
            data: {
                googleResourceId: listener.data.resourceId,
            },
        })

        console.log('💾 Stored googleResourceId in database:', listener.data.resourceId, 'Updated count:', channelStored.count)

        if (channelStored) {
            return new NextResponse('Listening to changes...')
        }
    }

    return new NextResponse('Oops! something went wrong, try again')
}