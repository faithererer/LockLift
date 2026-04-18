export namespace locklift {
	
	export class InspectSummary {
	    total: number;
	    killableCount: number;
	    blockedCount: number;
	
	    static createFrom(source: any = {}) {
	        return new InspectSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.killableCount = source["killableCount"];
	        this.blockedCount = source["blockedCount"];
	    }
	}
	export class LockingProcess {
	    pid: number;
	    name: string;
	    appType: string;
	    exePath: string;
	    canKill: boolean;
	    blockReason: string;
	
	    static createFrom(source: any = {}) {
	        return new LockingProcess(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.name = source["name"];
	        this.appType = source["appType"];
	        this.exePath = source["exePath"];
	        this.canKill = source["canKill"];
	        this.blockReason = source["blockReason"];
	    }
	}
	export class InspectResult {
	    path: string;
	    targetKind: string;
	    exists: boolean;
	    isFile: boolean;
	    isElevated: boolean;
	    hasLocks: boolean;
	    needsElevationHint: boolean;
	    scannedFileCount: number;
	    truncated: boolean;
	    processes: LockingProcess[];
	    summary: InspectSummary;
	    message: string;
	    warning?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new InspectResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.targetKind = source["targetKind"];
	        this.exists = source["exists"];
	        this.isFile = source["isFile"];
	        this.isElevated = source["isElevated"];
	        this.hasLocks = source["hasLocks"];
	        this.needsElevationHint = source["needsElevationHint"];
	        this.scannedFileCount = source["scannedFileCount"];
	        this.truncated = source["truncated"];
	        this.processes = this.convertValues(source["processes"], LockingProcess);
	        this.summary = this.convertValues(source["summary"], InspectSummary);
	        this.message = source["message"];
	        this.warning = source["warning"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class ReleaseAttempt {
	    pid: number;
	    name: string;
	    success: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ReleaseAttempt(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.name = source["name"];
	        this.success = source["success"];
	        this.message = source["message"];
	    }
	}
	export class ReleaseResult {
	    path: string;
	    requestedPids: number[];
	    releasedCount: number;
	    failedCount: number;
	    attempts: ReleaseAttempt[];
	    inspect: InspectResult;
	    message: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ReleaseResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.requestedPids = source["requestedPids"];
	        this.releasedCount = source["releasedCount"];
	        this.failedCount = source["failedCount"];
	        this.attempts = this.convertValues(source["attempts"], ReleaseAttempt);
	        this.inspect = this.convertValues(source["inspect"], InspectResult);
	        this.message = source["message"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

