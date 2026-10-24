export namespace main {
	
	export class BookData {
	    name: string;
	    path: string;
	    format: string;
	    size: number;
	    modTime: number;
	    dataBase64?: string;
	    text?: string;
	
	    static createFrom(source: any = {}) {
	        return new BookData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.format = source["format"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.dataBase64 = source["dataBase64"];
	        this.text = source["text"];
	    }
	}

}

