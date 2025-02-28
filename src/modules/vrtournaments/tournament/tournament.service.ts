import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tournament } from './tournament.entity';
import { VRAPIService } from '../../VRAPI/vrapi.service';
import { EventService } from '../event/event.service';
import { getLogger } from 'log4js';
import { License } from '../license/license.entity';
import { LicenseService } from '../license/license.service';
import { ConfigurationService } from '../../configuration/configuration.service';
import { JobState, JobStats } from '../../../utils/jobstats';
import { GradingDTO } from './grading-dto';
import { TournamentGradeApprovalService } from '../../tournament-grade-approval/tournament-grade-approval.service';

const TOURNAMENT_CREATION_COUNT = 'Tournaments created';
const TOURNAMENT_UPDATE_COUNT = 'Tournaments updated';
const TOURNAMENT_UP_TO_DATE_COUNT = 'Tournaments already up to date';
const LP_LEAGUE_CREATION_COUNT = 'League Planner leagues created';
const LP_LEAGUE_UPDATE_COUNT = 'League Planner leagues updated';
const LP_LEAGUE_UP_TO_DATE_COUNT = 'League Planner leagues already up to date';
const OL_LEAGUE_CREATION_COUNT = 'Online leagues created';
const OL_LEAGUE_UPDATE_COUNT = 'Online leagues updated';
const OL_LEAGUE_UP_TO_DATE_COUNT = 'Online leagues already up to date';
const BOX_LEAGUE_CREATION_COUNT = 'Box leagues created';
const BOX_LEAGUE_UPDATE_COUNT = 'Box leagues updated';
const BOX_LEAGUE_UP_TO_DATE_COUNT = 'Box leagues already up to date';
const BOX_LEAGUE_FORCED_RELOAD_COUNT =
  'Box leagues reloaded in spite of being up to date';
const SKIP_COUNT = 'Leagues and Tournaments skipped';
const DUPLICATE_COUNT = 'Tournaments or Leagues seen multiple times';
const DONE = 'Done (created + updated + already up to date + skipped)';

const logger = getLogger('tournamentService');

@Injectable()
export class TournamentService {
  private importStats: JobStats;

  constructor(
    private readonly config: ConfigurationService,
    @InjectRepository(Tournament)
    private readonly repository: Repository<Tournament>,
    private readonly eventService: EventService,
    private readonly licenseService: LicenseService,
    private readonly vrapi: VRAPIService,
    private readonly tournamentGradingApprovalService: TournamentGradeApprovalService,
  ) {
    this.importStats = new JobStats('tournamentImport');
  }

  async findAll(): Promise<Tournament[]> {
    return await this.repository.find();
  }

  // update the ts_stats_server database wrt tournaments.
  // Add any ones we did not know about and update any ones we
  // did know about if our version is out of date.
  async importTournamentsFromVR() {
    logger.info('**** VR Tournament Import started.');
    this.importStats = new JobStats('tournamentImport');
    this.importStats.setStatus(JobState.IN_PROGRESS);

    // If the current date is past June, load into next year
    const d = new Date();
    let year: number;
    if (d.getMonth() > 4) {
      year = d.getFullYear() + 1;
    } else {
      year = d.getFullYear();
    }

    // Some tournaments (Box Ladders in particular) may show up in the
    // tournament list for multiple years. So we keep track of the tournaments
    // we have done.
    const tournamentsDone: string[] = [];
    for (year; year >= this.config.tournamentUploadStartYear; year--) {
      if (
        this.importStats.get(TOURNAMENT_CREATION_COUNT) >=
        this.config.tournamentUploadLimit
      )
        break;
      await this.importTournamentsFromVRYear(year, tournamentsDone);
    }

    this.importStats.setStatus(JobState.DONE);
    logger.info('**** VR Tournament Import done.');
    return;
  }

  async importTournamentsFromVRYear(year: number, tournamentsDone: string[]) {
    // Ask the API for a list of tournaments since a configured start time
    // The API responds with an array an object containing only one item called
    // Tournament which is an array of mini tournamentId records.
    const miniTournaments_json = await this.vrapi.get(
      'Tournament/Year/' + year,
    );
    const miniTournaments: any[] = VRAPIService.arrayify(
      miniTournaments_json.Tournament,
    );
    logger.info(`${miniTournaments.length} tournaments found for ${year}`);

    const tournamentCount: number = miniTournaments.length;
    // the next line is not strictly true as many will be skipped and there
    // may be an import limit (but only during testing).  But it is a reasonable guess.
    this.importStats.toDo = this.importStats.toDo + tournamentCount;

    for (let i = tournamentCount - 1; i >= 0; i--) {
      const miniTournament = miniTournaments[i];

      // Some tournaments show up in multiple years (Box Ladders in particular)
      // So, keep track of ones that have been processed and don't redo any.
      if (tournamentsDone.includes(miniTournament.Code)) {
        this.importStats.bump(DUPLICATE_COUNT);
        logger.info(
          `Tournament ${miniTournament.Code} type: ${miniTournament.TypeID} seen multiple times`,
        );
        continue;
      } else {
        tournamentsDone.push(miniTournament.Code);
      }

      // 2022-10-20 add support for box leagues.
      // 2022-11-17 add support for on-line leagues
      if (
        '0' !== miniTournament.TypeID &&
        '1' !== miniTournament.TypeID &&
        '3' !== miniTournament.TypeID &&
        '10' !== miniTournament.TypeID
      ) {
        this.importStats.bump(SKIP_COUNT);
        logger.info(
          `Tournament has unknown code: ${miniTournament.Name} (${miniTournament.Code}). Code: ${miniTournament.TypeID}`,
        );
        continue;
      }

      // go see if we already have a record of the tournamentId.  If not make a new one
      const tournament: Tournament = await this.repository.findOne({
        where: {
          tournamentCode: miniTournament.Code,
        },
      });
      if (null == tournament) {
        logger.info('Creating: ' + JSON.stringify(miniTournament));
        if (miniTournament.TypeID === '0')
          this.importStats.bump(TOURNAMENT_CREATION_COUNT);
        if (miniTournament.TypeID === '1')
          this.importStats.bump(LP_LEAGUE_CREATION_COUNT);
        if (miniTournament.TypeID === '3')
          this.importStats.bump(OL_LEAGUE_CREATION_COUNT);
        if (miniTournament.TypeID === '10')
          this.importStats.bump(BOX_LEAGUE_CREATION_COUNT);
        await this.createTournamentFromVRAPI(miniTournament.Code);
      }

      // if our version is out of date, torch it and rebuild
      else if (tournament.isOutOfDate(miniTournament.LastUpdated)) {
        logger.info('Updating: ' + JSON.stringify(miniTournament, null, 2));
        if (miniTournament.TypeID === '0')
          this.importStats.bump(TOURNAMENT_UPDATE_COUNT);
        if (miniTournament.TypeID === '1')
          this.importStats.bump(LP_LEAGUE_UPDATE_COUNT);
        if (miniTournament.TypeID === '3')
          this.importStats.bump(OL_LEAGUE_UPDATE_COUNT);
        if (miniTournament.TypeID === '10')
          this.importStats.bump(BOX_LEAGUE_UPDATE_COUNT);
        await this.repository.remove(tournament);
        await this.createTournamentFromVRAPI(miniTournament.Code);
      }

      // otherwise, our version is up-to-date, and we can skip along.
      else {
        if (miniTournament.TypeID === '0')
          this.importStats.bump(TOURNAMENT_UP_TO_DATE_COUNT);
        if (miniTournament.TypeID === '1')
          this.importStats.bump(LP_LEAGUE_UP_TO_DATE_COUNT);
        if (miniTournament.TypeID === '3')
          this.importStats.bump(OL_LEAGUE_UP_TO_DATE_COUNT);
        if (miniTournament.TypeID === '10') {
          // 2024-07-25 It turns out that for Box Ladders, the LastUpdated value
          // DOES NOT get updated when match results are added. So we have to reload
          // them by force on occasion.
          if (this.config.boxLadderForceReloadPercent > Math.random() * 100) {
            logger.info(`Forced reload of Box Ladder ${miniTournament.Code}`);
            await this.repository.remove(tournament);
            await this.createTournamentFromVRAPI(miniTournament.Code);
            this.importStats.bump(BOX_LEAGUE_FORCED_RELOAD_COUNT);
          } else {
            this.importStats.bump(BOX_LEAGUE_UP_TO_DATE_COUNT);
          }
        }
      }

      this.importStats.bump(DONE);

      // Break out early, but really only used during development.
      if (
        this.importStats.get(TOURNAMENT_CREATION_COUNT) >=
        this.config.tournamentUploadLimit
      )
        break;
    }
    return;
  }

  async createTournamentFromVRAPI(tournamentCode: string): Promise<boolean> {
    const tournament = new Tournament();
    let apiTournament = await this.vrapi.get('Tournament/' + tournamentCode);

    // sluff off the outer layer of the returned object.
    apiTournament = apiTournament.Tournament;

    // Lookup the license - this is the only reliable way to get the
    // province for the tournament.
    const license: License = await this.licenseService.lookupOrCreate(
      apiTournament.Organization.Name,
    );

    // Create the tournament object.
    tournament.buildFromVRAPIObj(apiTournament);
    tournament.license = license;
    await this.repository.save(tournament);

    // Now dig down and import the events for this tournament
    await this.eventService.importEventsFromVR(tournament, this.importStats);
    return true;
  }

  /* this is vestigial from the time that tournament loader was run manually
   * and the client had to poll to find out the status of the loader.
   * But I can see it being useful again at some point.
   */
  getImportStatus(): string {
    return JSON.stringify(this.importStats);
  }

  /*
   * Create a report. Each row represents the fact that a particular player played in
   * some singles event in some tournament in a given time period.
   */
  async getPlayReport(
    fromDate: Date = null,
    toDate: Date = null,
  ): Promise<any[]> {
    const q = this.repository
      .createQueryBuilder('t')
      .select([
        'p.playerId',
        'p.firstName',
        'p.lastName',
        'p.DOB',
        'p.gender',
        'p.province',
      ])
      .addSelect(['c.categoryId', 'c.categoryName'])
      .addSelect([
        'e.name',
        'e.genderId',
        'e.level',
        'e.minAge',
        'e.maxAge',
        'e.winnerPoints',
      ])
      .addSelect(['t.name', 't.level', 't.startDate', 't.endDate', 't.city'])
      .addSelect(['l.licenseName', 'l.province'])
      .leftJoin('t.license', 'l')
      .leftJoin('t.events', 'e')
      .leftJoin('e.vrRankingsCategory', 'c')
      .leftJoin('e.matches', 'm')
      .leftJoin('m.matchPlayers', 'mp')
      .leftJoin('mp.player', 'p')
      .where('e.isSingles')
      .andWhere('p.playerId')
      .andWhere(`t.endDate <= '${toDate}'`)
      .andWhere(`t.endDate >= '${fromDate}'`)
      .groupBy('e.eventId')
      .addGroupBy('p.playerId')
      .orderBy('t.name');

    return await q.getRawMany();
  }

  async getTournamentsUpdatedSince(date: string): Promise<Tournament[]> {
    return this.repository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.license', 'l')
      .where(`t.lastUpdatedInVR >= '${date}'`)
      .getMany();
  }

  async getTournamentWithEventsAndLicense(
    tournamentCode: string,
  ): Promise<Tournament> {
    return this.repository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.license', 'l')
      .leftJoinAndSelect(`t.events`, 'e')
      .leftJoinAndSelect('e.vrRankingsCategory', 'c')
      .where(`t.tournamentCode = '${tournamentCode}'`)
      .getOne();
  }

  async getCurrentGradings(query: any): Promise<GradingDTO[]> {
    let q = this.repository
      .createQueryBuilder('t')
      .where('t.endDate >= :ed', { ed: query.since })
      .orderBy('t.endDate');

    // the client is looking for leagues, box ladders or tournaments
    const selectedTournamentTypes = [];
    switch (query.tournamentCategory) {
      case 'boxLadders':
        selectedTournamentTypes.push(10);
        break;
      case 'tournaments':
        selectedTournamentTypes.push(0);
        break;
      default: //leagues are the default
        selectedTournamentTypes.push(1);
        selectedTournamentTypes.push(3);
    }
    q = q.andWhere('t.typeId IN (:...selectedTournamentTypes)', {
      selectedTournamentTypes,
    });

    const tournaments: Tournament[] = await q.getMany();
    const gradings: GradingDTO[] = [];
    for (const t of tournaments) {
      const mostRecentApprovedGrading =
        await this.tournamentGradingApprovalService.getMostRecentApproval(
          t.tournamentCode,
        );
      if (
        query.showAll ||
        !mostRecentApprovedGrading ||
        mostRecentApprovedGrading.approvedLevel !== t.level
      ) {
        gradings.push(new GradingDTO(t, mostRecentApprovedGrading));
      }
    }
    return gradings;
  }
}
