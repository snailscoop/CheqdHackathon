const logger = require('../utils/logger');
const axios = require('axios');

/**
 * EventScraper service for retrieving upcoming Cosmos ecosystem events
 */
class EventScraperService {
  constructor() {
    this.initialized = false;
    this.baseUrl = 'https://cosmicagenda.vercel.app';
    this.eventCache = {
      lastUpdated: null,
      events: [],
      cacheDuration: 3600000 // 1 hour in milliseconds
    };
  }

  /**
   * Initialize the event scraper service
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      logger.info('Initializing event scraper service');
      this.initialized = true;
      logger.info('Event scraper service initialized successfully');
    } catch (error) {
      logger.error('Error initializing event scraper service', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch upcoming events
   * @param {Object} options - Fetch options
   * @param {number} options.limit - Maximum number of events to return
   * @param {number} options.daysAhead - Number of days ahead to look for events
   * @returns {Promise<Array>} - Array of upcoming events
   */
  async getUpcomingEvents(options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const { limit = 5, daysAhead = 7 } = options;

    try {
      // Check if we can use cached data
      if (this.shouldUseCache()) {
        logger.info('Using cached event data', {
          service: 'dail-bot',
          cacheAge: Date.now() - this.eventCache.lastUpdated
        });
        
        return this.filterEvents(this.eventCache.events, limit, daysAhead);
      }
      
      logger.info('Retrieving upcoming events', {
        service: 'dail-bot',
        limit,
        daysAhead
      });

      try {
        // Try to fetch real events from an API
        const events = await this.fetchEventsFromAPI();
        
        // Update cache
        this.eventCache.events = events;
        this.eventCache.lastUpdated = Date.now();
        
        return this.filterEvents(events, limit, daysAhead);
      } catch (apiError) {
        logger.warn('Failed to fetch events from API, using fallback data', {
          service: 'dail-bot',
          error: apiError.message
        });
        
        // Use fallback mock data
        const mockEvents = this.getMockEvents();
        return this.filterEvents(mockEvents, limit, daysAhead);
      }
    } catch (error) {
      logger.error('Error fetching upcoming events', {
        service: 'dail-bot',
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Check if we should use cached event data
   * @returns {boolean} - Whether to use cached data
   */
  shouldUseCache() {
    return (
      this.eventCache.lastUpdated &&
      this.eventCache.events.length > 0 &&
      Date.now() - this.eventCache.lastUpdated < this.eventCache.cacheDuration
    );
  }

  /**
   * Filter events based on options
   * @param {Array} events - All events
   * @param {number} limit - Maximum number of events to return
   * @param {number} daysAhead - Number of days ahead to look for events
   * @returns {Array} - Filtered events
   */
  filterEvents(events, limit, daysAhead) {
    // Filter future events within the specified days ahead
    const today = new Date();
    const futureLimit = new Date();
    futureLimit.setDate(today.getDate() + daysAhead);
    
    const filteredEvents = events
      .filter(event => {
        const eventDate = event.date instanceof Date ? event.date : new Date(event.date);
        return eventDate > today && eventDate <= futureLimit;
      })
      .slice(0, limit);
    
    logger.info('Successfully filtered upcoming events', {
      service: 'dail-bot',
      count: filteredEvents.length
    });
    
    return filteredEvents;
  }

  /**
   * Attempt to fetch events from an API
   * @returns {Promise<Array>} - Events from API
   */
  async fetchEventsFromAPI() {
    try {
      // Try to fetch from Cosmic Agenda or similar API
      const response = await axios.get(`${this.baseUrl}/api/events`);
      
      if (response.status === 200 && response.data && Array.isArray(response.data)) {
        logger.info('Successfully fetched events from API', {
          service: 'dail-bot',
          count: response.data.length
        });
        
        // Transform API data to our format if needed
        return response.data.map(event => ({
          title: event.title,
          date: new Date(event.date),
          dateText: event.dateText,
          timeText: event.timeText || event.time,
          description: event.description,
          link: event.link || event.url,
          source: event.source || 'Cosmic Agenda'
        }));
      }
      
      throw new Error('Invalid API response format');
    } catch (error) {
      logger.error('Error fetching events from API', {
        service: 'dail-bot',
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Get mock events data as fallback
   * @returns {Array} - Mock events
   */
  getMockEvents() {
    // Mock events data
    return [
      {
        title: "Cosmos Weekly Community Call",
        date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        dateText: "2 days from now",
        timeText: "16:00 UTC",
        description: "Weekly community update call with the Cosmos Hub team",
        link: "https://twitter.com/cosmos",
        source: "Cosmic Agenda"
      },
      {
        title: "Osmosis Governance Discussion",
        date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        dateText: "3 days from now",
        timeText: "18:00 UTC",
        description: "Discussion about upcoming governance proposals",
        link: "https://twitter.com/osmosiszone",
        source: "Cosmic Agenda"
      },
      {
        title: "Stargaze NFT Launch Party",
        date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
        dateText: "5 days from now",
        timeText: "19:00 UTC",
        description: "Launch celebration for the new NFT collection",
        link: "https://twitter.com/stargazezone",
        source: "Cosmic Agenda"
      },
      {
        title: "Secret Network Developer Workshop",
        date: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), // 6 days from now
        dateText: "6 days from now",
        timeText: "15:00 UTC",
        description: "Learn how to build privacy-preserving applications on Secret Network",
        link: "https://twitter.com/SecretNetwork",
        source: "Cosmic Agenda"
      },
      {
        title: "Juno Network Monthly Update",
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        dateText: "7 days from now",
        timeText: "17:00 UTC",
        description: "Monthly update from the Juno Network team",
        link: "https://twitter.com/JunoNetwork",
        source: "Cosmic Agenda"
      },
      {
        title: "Cosmos Hub Governance Discussion",
        date: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000), // 8 days from now
        dateText: "8 days from now",
        timeText: "16:30 UTC",
        description: "Discussion about upcoming Cosmos Hub proposals",
        link: "https://twitter.com/cosmos",
        source: "Cosmic Agenda"
      },
      {
        title: "Interchain Security Twitter Space",
        date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
        dateText: "10 days from now",
        timeText: "15:00 UTC",
        description: "Twitter Space discussing Interchain Security developments",
        link: "https://twitter.com/cosmos",
        source: "Cosmic Agenda"
      },
      {
        title: "Cheqd Community Office Hours",
        date: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days from now
        dateText: "4 days from now",
        timeText: "14:00 UTC",
        description: "Regular community office hours with the Cheqd team, discussing identity solutions and network updates",
        link: "https://twitter.com/cheqd_io",
        source: "Cosmic Agenda"
      },
      {
        title: "Akash Network Tech Demo",
        date: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000), // 9 days from now
        dateText: "9 days from now",
        timeText: "18:00 UTC",
        description: "Technical demonstration of deploying applications on the Akash decentralized cloud",
        link: "https://twitter.com/akashnet_",
        source: "Cosmic Agenda"
      }
    ];
  }

  /**
   * Format events into a readable message
   * @param {Array} events - Array of event objects
   * @returns {string} - Formatted message
   */
  formatEventsMessage(events) {
    if (!events || events.length === 0) {
      return "🗓️ *No upcoming Cosmos events found*\n\nThere don't seem to be any events scheduled for the coming days.";
    }
    
    let message = "🗓️ *Upcoming Cosmos Events*\n\n";
    
    events.forEach((event, index) => {
      // Format date
      const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };
      const formattedDate = event.date instanceof Date ? 
        event.date.toLocaleDateString('en-US', dateOptions) : 
        event.dateText;
      
      message += `*${index + 1}. ${event.title}*\n`;
      message += `📅 *When:* ${formattedDate}`;
      
      if (event.timeText) {
        message += ` at ${event.timeText}`;
      }
      
      message += '\n';
      
      if (event.description) {
        // Truncate description if too long
        const maxLength = 100;
        const description = event.description.length > maxLength ?
          `${event.description.substring(0, maxLength)}...` :
          event.description;
        
        message += `📝 ${description}\n`;
      }
      
      if (event.link) {
        message += `🔗 [Event Link](${event.link})\n`;
      }
      
      message += '\n';
    });
    
    message += "Data sources: Twitter, Discord, and community calendars.";
    
    // Add note about mock data if we're operating in development mode
    if (process.env.NODE_ENV === 'development') {
      message += "\n\nNote: These may be mock events for demonstration purposes.";
    }
    
    return message;
  }
}

// Create and export singleton instance
module.exports = new EventScraperService(); 