export class Loader {
    static startLoader(repo: any): NodeJS.Timeout {
        const frames = ['.', '..', '...'];
        let i = 0;
        repo.inputBox.value = 'Generating commit message' + frames[0];
        return setInterval(() => {
            i = (i + 1) % frames.length;
            repo.inputBox.value = 'Generating commit message' + frames[i];
        }, 400);
    }

    static stopLoader(timer: NodeJS.Timeout): void {
        clearInterval(timer);
    }
}